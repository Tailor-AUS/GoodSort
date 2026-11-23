namespace GoodSort.Api.Services;

/// <summary>
/// Vision fallback defaults, in one place so the code and the deploy script
/// cannot disagree about them.
///
/// They already had. VisionService defaulted the Azure OpenAI deployment to
/// "gpt-4.1" while infra/restore-secrets.sh recorded that gpt-4.1 does not
/// exist in oai-tailor-app-prod and gpt-5-mini is the only one verified to
/// work. Two places holding one fact, and the one the code fell back on was
/// the wrong one.
/// </summary>
public static class VisionDefaults
{
    /// <summary>
    /// Must match the default in infra/restore-secrets.sh. Pinned by
    /// VisionDefaultsTests, which reads that script rather than trusting a
    /// comment to stay true.
    /// </summary>
    public const string OpenAiDeployment = "gpt-5-mini";

    /// <summary>
    /// Default model/tier alias when routing OpenAI-compatible vision calls
    /// through the PACT/Sovrgn gateway (https://api.sovrgn.ai/v1). Under
    /// GoodSort's onshore tenant profile (X-Sovrgn-Tenant: goodsort),
    /// api.sovrgn.ai resolves tailor-fast to au-inregion-gpt-41-mini with
    /// automatic failover to au-inregion-gpt-4o.
    /// </summary>
    public const string PactModel = "tailor-fast";

    /// <summary>
    /// Default image detail level ("low" | "high" | "auto"). Low detail sends a
    /// single low-resolution tile (~4-6x faster and ~5-10x fewer image tokens
    /// than high detail), matching tailor-app's VisionClassificationService.
    /// </summary>
    public const string ImageDetail = "low";

    /// <summary>
    /// Default per-provider vision HTTP timeout in seconds (clamped 3..60).
    /// Prevents a stalled upstream from blocking the scanner UI for 100s.
    /// </summary>
    public const int TimeoutSeconds = 15;

    /// <summary>
    /// Output token ceiling applied only to non-reasoning models (e.g.
    /// gpt-4.1-mini, gpt-4.1-nano, gpt-4o-mini). Never applied to reasoning
    /// models (gpt-5*, o1/o3/o4) where a low cap can be exhausted by hidden
    /// reasoning tokens and yield empty content.
    /// </summary>
    public const int NonReasoningMaxOutputTokens = 400;
}
