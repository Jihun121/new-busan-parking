(() => {
    const form = document.querySelector("#aiSearchForm");
    const input = document.querySelector("#aiSearchInput");
    const button = document.querySelector("#aiSearchBtn");
    const status = document.querySelector("#aiSearchStatus");
    const answerPanel = document.querySelector("#aiAnswerPanel");
    const answerText = document.querySelector("#aiAnswerText");
    const chips = document.querySelectorAll("[data-ai-prompt]");

    if (!form || !input || !button || !status || !answerPanel || !answerText) return;

    const CREATE_FETCH_TIMEOUT_MS = 18_000;
    const POLL_FETCH_TIMEOUT_MS = 45_000;
    const MAX_TOTAL_WAIT_MS = 180_000;
    const SAME_QUERY_CACHE_MS = 30_000;
    const POLL_INTERVAL_MS = 8_000;
    let isSearching = false;
    let lastSuccessfulQuery = null;

    function setStatus(message = "", kind = "") {
        status.className = "ai-search-status";
        if (kind) status.classList.add(kind);
        status.textContent = message;
    }

    function setBusy(busy) {
        isSearching = busy;
        button.disabled = busy;
        input.disabled = busy;
        button.innerHTML = busy
            ? '<span aria-hidden="true">…</span> 검색 중'
            : '<span aria-hidden="true">✦</span> AI로 찾기';
        chips.forEach(chip => { chip.disabled = busy; });
    }

    async function fetchJson(url, options = {}, timeoutMs = 18_000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
            let payload;
            try { payload = await response.json(); }
            catch { throw new Error("서버에서 올바른 JSON 응답을 받지 못했습니다."); }
            return { response, payload };
        } catch (error) {
            if (error?.name === "AbortError") {
                const timeoutError = new Error("서버 응답이 늦어졌습니다. 잠시 후 다시 시도해 주세요.");
                timeoutError.code = "BROWSER_FETCH_TIMEOUT";
                throw timeoutError;
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    function makeHttpError(response, payload) {
        const parts = [payload?.error || `AI 검색 요청 실패 (HTTP ${response.status})`];
        if (payload?.upstreamStatus) parts.push(`Gemini HTTP ${payload.upstreamStatus}`);
        if (payload?.providerStatus) parts.push(`상태 ${payload.providerStatus}`);
        if (payload?.code) parts.push(`오류 코드 ${payload.code}`);
        if (payload?.detail) parts.push(`상세: ${payload.detail}`);
        if (payload?.diagnostic && typeof payload.diagnostic === "object") {
            const diagnostic = payload.diagnostic;
            const details = [
                diagnostic.name,
                diagnostic.message,
                diagnostic.causeCode ? `causeCode=${diagnostic.causeCode}` : "",
                diagnostic.causeName ? `causeName=${diagnostic.causeName}` : "",
                diagnostic.causeMessage ? `cause=${diagnostic.causeMessage}` : ""
            ].filter(Boolean);
            if (details.length) parts.push(`연결 진단: ${details.join(" / ")}`);
        }
        throw new Error(parts.join(" · "));
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitForInteraction(interactionId, model) {
        const startedAt = Date.now();
        let consecutiveTransientErrors = 0;

        while (Date.now() - startedAt < MAX_TOTAL_WAIT_MS) {
            const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
            setStatus(`Gemini가 주차장 도구를 실행하고 답변을 준비하고 있습니다… ${elapsedSeconds}초`, "loading");
            await delay(POLL_INTERVAL_MS);

            let response;
            let payload;
            try {
                const result = await fetchJson(
                    `/api/ai-search?interactionId=${encodeURIComponent(interactionId)}`,
                    { method: "GET", headers: { Accept: "application/json" } },
                    POLL_FETCH_TIMEOUT_MS
                );
                response = result.response;
                payload = result.payload;
            } catch (error) {
                consecutiveTransientErrors += 1;
                if (consecutiveTransientErrors <= 2 && Date.now() - startedAt < MAX_TOTAL_WAIT_MS) {
                    setStatus("작업 상태 확인이 지연되어 다시 확인하고 있습니다…", "loading");
                    await delay(1_500 * consecutiveTransientErrors);
                    continue;
                }
                throw error;
            }

            if (response.status === 202 || payload?.status === "in_progress" || payload?.status === "queued") {
                consecutiveTransientErrors = 0;
                continue;
            }
            if (!response.ok) {
                // Gemini can temporarily return 500/502/503/504 while its backend is overloaded.
                // Polling an existing interaction is an idempotent GET, so retry with backoff
                // instead of dropping the user's in-progress query at the first provider error.
                const upstreamStatus = Number(payload?.upstreamStatus || 0);
                const transientProviderError =
                    payload?.code === "GEMINI_UPSTREAM_ERROR" &&
                    [500, 502, 503, 504].includes(upstreamStatus);
                const transientTransportError = [
                    "GEMINI_POLL_TIMEOUT",
                    "GEMINI_CONNECTION_FAILED"
                ].includes(payload?.code);

                if ((transientProviderError || transientTransportError) && consecutiveTransientErrors < 2) {
                    consecutiveTransientErrors += 1;
                    const retryDelayMs = Math.min(2_000 * (2 ** (consecutiveTransientErrors - 1)), 8_000);
                    const reason = transientProviderError
                        ? `Gemini 서버가 일시적으로 혼잡합니다. 잠시 기다린 뒤 작업 상태를 다시 확인합니다… (${consecutiveTransientErrors}/2)`
                        : `작업 상태 연결이 일시적으로 불안정합니다. 다시 확인합니다… (${consecutiveTransientErrors}/2)`;
                    setStatus(reason, "loading");
                    await delay(retryDelayMs);
                    continue;
                }
                makeHttpError(response, payload);
            }
            consecutiveTransientErrors = 0;
            if (payload?.answer && typeof payload.answer === "string") {
                return { answer: payload.answer, model: payload.model || model };
            }
            makeHttpError(response, payload || {});
        }

        const timeoutError = new Error("AI 검색이 3분 안에 완료되지 않았습니다. 작업이 백그라운드에서 계속될 수 있으니 잠시 후 다시 시도해 주세요. 오류 코드 GEMINI_CLIENT_WAIT_TIMEOUT");
        timeoutError.code = "GEMINI_CLIENT_WAIT_TIMEOUT";
        throw timeoutError;
    }

    async function submitQuery() {
        const query = input.value.trim();
        if (isSearching) return;
        if (!query) {
            setStatus("검색할 내용을 입력해 주세요.", "error");
            input.focus();
            return;
        }
        if (query.length > 800) {
            setStatus("질문은 800자 이내로 입력해 주세요.", "error");
            return;
        }

        const normalizedQuery = query.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
        if (lastSuccessfulQuery &&
            lastSuccessfulQuery.normalizedQuery === normalizedQuery &&
            Date.now() - lastSuccessfulQuery.timestamp < SAME_QUERY_CACHE_MS) {
            answerText.textContent = lastSuccessfulQuery.answer;
            answerPanel.hidden = false;
            setStatus("같은 질문의 직전 답변을 재사용했습니다. 30초 안에는 추가 Gemini 요청을 보내지 않습니다.", "");
            return;
        }

        setBusy(true);
        setStatus("Gemini가 AI 검색 작업을 시작하고 있습니다…", "loading");
        answerPanel.hidden = true;
        answerText.textContent = "";

        try {
            const { response, payload } = await fetchJson("/api/ai-search", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ query })
            }, CREATE_FETCH_TIMEOUT_MS);

            if (!response.ok) makeHttpError(response, payload);

            let result;
            if (payload?.answer && typeof payload.answer === "string") {
                result = { answer: payload.answer, model: payload.model || "Gemini" };
            } else if (payload?.interactionId && (response.status === 202 || payload.status === "in_progress" || payload.status === "queued")) {
                result = await waitForInteraction(payload.interactionId, payload.model || "Gemini");
            } else {
                makeHttpError(response, payload || {});
            }

            answerText.textContent = result.answer;
            answerPanel.hidden = false;
            lastSuccessfulQuery = {
                normalizedQuery,
                answer: result.answer,
                model: result.model || "Gemini",
                timestamp: Date.now()
            };
            setStatus(`검색 완료 · ${result.model || "Gemini"} + MCP`, "");
        } catch (error) {
            console.error("AI parking search failed:", error);
            setStatus(error?.message || "AI 검색 중 오류가 발생했습니다.", "error");
        } finally {
            setBusy(false);
        }
    }

    form.addEventListener("submit", event => {
        event.preventDefault();
        submitQuery();
    });

    input.addEventListener("keydown", event => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submitQuery();
        }
    });

    chips.forEach(chip => {
        chip.addEventListener("click", () => {
            input.value = chip.getAttribute("data-ai-prompt") || "";
            input.focus();
        });
    });
})();
