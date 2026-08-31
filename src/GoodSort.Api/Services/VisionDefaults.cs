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
}
