using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// The code's vision-deployment default has to match the one the deploy script
/// sets, because they are two statements of the same fact and they had already
/// drifted: the code fell back to "gpt-4.1", which restore-secrets.sh records
/// as not existing in oai-tailor-app-prod.
///
/// It only bites if AZURE_OPENAI_DEPLOYMENT goes missing — but `azd deploy`
/// strips env vars, which is exactly why that script exists. The result would
/// be every photo scan failing with "Something went wrong analysing that
/// photo" and an Azure OpenAI 404 underneath.
///
/// This reads the script rather than restating its value, so the two cannot
/// drift again without failing here.
/// </summary>
public class VisionDefaultsTests
{
    [Fact]
    public void The_code_default_matches_what_the_deploy_script_sets()
    {
        var script = FindRepoFile(Path.Combine("infra", "restore-secrets.sh"));
        var text = File.ReadAllText(script);

        var marker = "AZURE_OPENAI_DEPLOYMENT=\"${AZURE_OPENAI_DEPLOYMENT:-";
        var start = text.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(start >= 0, $"Could not find the deployment default in {script}.");

        start += marker.Length;
        var end = text.IndexOf('}', start);
        var fromScript = text[start..end];

        Assert.Equal(VisionDefaults.OpenAiDeployment, fromScript);
    }

    [Fact]
    public void The_default_is_not_the_deployment_that_does_not_exist()
    {
        // Named explicitly, because this is the value that was there and the
        // reason it was wrong is not obvious from the string itself.
        Assert.NotEqual("gpt-4.1", VisionDefaults.OpenAiDeployment);
    }

    private static string FindRepoFile(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, relative)))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, relative);
    }
}
