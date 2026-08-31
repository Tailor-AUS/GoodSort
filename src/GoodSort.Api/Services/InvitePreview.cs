namespace GoodSort.Api.Services;

/// <summary>
/// How a member's name may appear to someone who is not signed in.
///
/// Written for the invite card — first name and suburb only, never email or
/// address — but the rule is not specific to invites. Any anonymous response
/// carrying a member's name should go through it. The runner leaderboard did
/// not, and returned full names to anyone who asked.
/// </summary>
public static class InvitePreview
{
    /// <param name="fallback">
    /// Shown when the name is unusable — an email address, a placeholder, or an
    /// implausible length. Caller-supplied because "A neighbour" reads oddly on
    /// a runner leaderboard, and a wrong-sounding label invites someone to
    /// bypass this helper rather than use it.
    /// </param>
    public static string PublicFirstName(string? name, string fallback = "A neighbour")
    {
        var first = (name ?? "").Trim()
            .Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault() ?? "";
        if (first.Contains('@') || first.Length is < 2 or > 24) return fallback;
        if (first.Equals("New", StringComparison.OrdinalIgnoreCase)
            || first.Equals("You", StringComparison.OrdinalIgnoreCase))
            return fallback;
        return first;
    }
}
