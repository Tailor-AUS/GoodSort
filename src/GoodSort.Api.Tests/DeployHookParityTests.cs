namespace GoodSort.Api.Tests;

/// <summary>
/// There is one postdeploy implementation, not one per platform.
///
/// azure.yaml routes Windows to infra/restore-secrets.ps1 and everything else
/// to infra/restore-secrets.sh. When those were two implementations of the same
/// procedure, the .ps1 silently stopped receiving fixes: it last changed in #8
/// while the .sh went on to gain #18, #25 and #26. On Windows, `azd deploy`
/// therefore did the opposite of what the repo documents — wrote
/// ACS_CONNECTION_STRING as a plaintext env var, and re-linked thegoodsort.org
/// onto tailor-app's shared Communication Service, which is the exact coupling
/// #25 removed.
///
/// Nothing could catch that. No build, lint or test reads a .ps1, CI never runs
/// it, and the GitHub deploy path uses `az acr build` instead. It executes only
/// on a manual `azd deploy` from Windows, and prints success either way.
///
/// So the rule is structural rather than behavioural: the Windows hook may not
/// contain deployment logic of its own. If it cannot act, it cannot drift.
/// </summary>
public class DeployHookParityTests
{
    [Fact]
    public void The_windows_hook_delegates_rather_than_reimplementing()
    {
        var ps1 = File.ReadAllText(FindRepoFile(Path.Combine("infra", "restore-secrets.ps1")));

        // Comments explaining the history are fine; commands are not. Strip
        // comment lines before looking for anything that acts.
        var code = string.Join(
            "\n",
            ps1.Split('\n').Where(l => !l.TrimStart().StartsWith("#", StringComparison.Ordinal)));

        Assert.DoesNotContain("az containerapp", code, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("az rest", code, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("linkedDomains", code, StringComparison.OrdinalIgnoreCase);

        // And it must actually hand off to the one implementation.
        Assert.Contains("restore-secrets.sh", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Both_platforms_are_still_wired_to_a_hook()
    {
        // If the windows block is dropped, azd falls back to `shell: sh`, which
        // needs a POSIX shell that Windows does not ship. Silently doing nothing
        // after a deploy is how env vars go missing.
        var azure = File.ReadAllText(FindRepoFile("azure.yaml"));

        Assert.Contains("restore-secrets.sh", azure, StringComparison.Ordinal);
        Assert.Contains("restore-secrets.ps1", azure, StringComparison.Ordinal);
        Assert.Contains("continueOnError: false", azure, StringComparison.Ordinal);
    }

    [Fact]
    public void The_posix_hook_keeps_credentials_out_of_plaintext_env_vars()
    {
        // The property #26 established, pinned so a future edit to the one
        // remaining implementation cannot quietly undo it.
        var sh = File.ReadAllText(FindRepoFile(Path.Combine("infra", "restore-secrets.sh")));

        foreach (var secret in new[] { "JWT_SECRET", "ACS_CONNECTION_STRING", "AZURE_OPENAI_KEY" })
        {
            Assert.True(
                sh.Contains($"{secret}=secretref:", StringComparison.Ordinal),
                $"{secret} must be set as a container-app secret reference, not a plaintext value.");
        }
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
