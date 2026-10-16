(() => {
    const form = document.querySelector("#aiSearchForm");
    const input = document.querySelector("#aiSearchInput");
    const button = document.querySelector("#aiSearchBtn");
    const status = document.querySelector("#aiSearchStatus");
    const answerPanel = document.querySelector("#aiAnswerPanel");
    const answerText = document.querySelector("#aiAnswerText");
    const chips = document.querySelectorAll("[data-ai-prompt]");

    if (!form || !input || !button || !status || !answerPanel || !answerText) return;

    let isSearching = false;

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

        setBusy(true);
        setStatus("Gemini가 MCP 도구로 주차장 데이터를 조회하고 있습니다…", "loading");
        answerPanel.hidden = true;
        answerText.textContent = "";

        try {
            const response = await fetch("/api/ai-search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify({ query })
            });

            let payload;
            try {
                payload = await response.json();
            } catch {
                throw new Error("서버에서 올바른 JSON 응답을 받지 못했습니다.");
            }

            if (!response.ok) {
                const message = payload?.error || `AI 검색 요청 실패 (HTTP ${response.status})`;
                const parts = [message];
                if (payload?.upstreamStatus) parts.push(`Gemini HTTP ${payload.upstreamStatus}`);
                if (payload?.providerStatus) parts.push(`상태 ${payload.providerStatus}`);
                if (payload?.code) parts.push(`오류 코드 ${payload.code}`);
                if (payload?.detail) parts.push(`상세: ${payload.detail}`);
                throw new Error(parts.join(" · "));
            }

            if (!payload?.answer || typeof payload.answer !== "string") {
                throw new Error("AI가 답변을 반환하지 않았습니다. 질문을 조금 바꿔 다시 시도해 주세요.");
            }

            answerText.textContent = payload.answer;
            answerPanel.hidden = false;
            setStatus(`검색 완료 · ${payload.model || "Gemini"} + MCP`, "");
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
