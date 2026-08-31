namespace GoodSort.Api.Tests;

/// <summary>
/// The funnel's event names are declared twice — TRACKED_EVENTS in
/// lib/analytics.ts and waitlistEvents in Program.cs — and both files carry a
/// comment saying they must stay in step. Nothing enforced it.
///
/// Drift is silent in both directions, which is what makes it worth a test.
/// A name the client sends but the server does not know gets a bare 400 that
/// track() discards, so the call site looks fine and the event simply never
/// exists. A name the server knows but no client sends is a step that reads as
/// a hard zero in /api/admin/funnel — indistinguishable from "nobody did it".
/// Either way the number you make a decision on is wrong, and nothing anywhere
/// reports a problem.
///
/// Reads both files as text rather than restating the list, because a third
/// copy would be one more thing to drift.
/// </summary>
public class GrowthEventParityTests
{
    [Fact]
    public void The_client_and_server_event_allowlists_are_identical()
    {
        var client = ClientEvents();
        var server = ServerEvents();

        // Two empty sets are equal, so an extraction that silently matched
        // nothing would pass this test while checking nothing at all. That is
        // the failure mode most likely to survive a refactor of either file.
        Assert.True(client.Count >= 10, $"Only found {client.Count} events in lib/analytics.ts — the extraction is probably broken, not the list.");
        Assert.True(server.Count >= 10, $"Only found {server.Count} events in Program.cs — the extraction is probably broken, not the list.");

        // Activation is the one that matters most; name it so a rename cannot
        // quietly drop it from both sides at once and still pass.
        Assert.Contains("first_scan_credited", client);
        Assert.Contains("first_scan_credited", server);
        Assert.Contains("scan_credited", client);
        Assert.Contains("scan_credited", server);

        var clientOnly = client.Except(server).OrderBy(x => x).ToList();
        var serverOnly = server.Except(client).OrderBy(x => x).ToList();

        Assert.True(
            clientOnly.Count == 0,
            "Sent by the client but rejected by the server, so these events never exist: " + string.Join(", ", clientOnly));
        Assert.True(
            serverOnly.Count == 0,
            "Known to the server but never sent, so these read as a real zero in the funnel: " + string.Join(", ", serverOnly));
    }

    private static HashSet<string> ClientEvents()
    {
        var text = File.ReadAllText(FindRepoFile(Path.Combine("lib", "analytics.ts")));
        return QuotedNames(Between(text, "TRACKED_EVENTS = [", "]", "lib/analytics.ts"));
    }

    private static HashSet<string> ServerEvents()
    {
        var text = File.ReadAllText(FindRepoFile(Path.Combine("src", "GoodSort.Api", "Program.cs")));
        var decl = text.IndexOf("var waitlistEvents = new HashSet<string>", StringComparison.Ordinal);
        Assert.True(decl >= 0, "Could not find waitlistEvents in Program.cs — if it moved or was renamed, update this test rather than deleting it.");

        var open = text.IndexOf('{', decl);
        Assert.True(open >= 0, "Found waitlistEvents but not its initialiser.");
        return QuotedNames(Between(text[open..], "{", "}", "Program.cs"));
    }

    private static string Between(string text, string startMarker, string endMarker, string where)
    {
        var start = text.IndexOf(startMarker, StringComparison.Ordinal);
        Assert.True(start >= 0, $"Could not find '{startMarker}' in {where}.");
        start += startMarker.Length;

        var end = text.IndexOf(endMarker, start, StringComparison.Ordinal);
        Assert.True(end > start, $"Could not find '{endMarker}' after '{startMarker}' in {where}.");
        return text[start..end];
    }

    /// <summary>Every double-quoted run in the block. The lists hold nothing else.</summary>
    private static HashSet<string> QuotedNames(string block)
    {
        var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var parts = block.Split('"');
        // Odd indices are the insides of quotes.
        for (var i = 1; i < parts.Length; i += 2)
        {
            var name = parts[i].Trim();
            if (name.Length > 0) found.Add(name);
        }
        return found;
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
