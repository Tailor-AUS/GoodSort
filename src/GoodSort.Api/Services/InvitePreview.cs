namespace GoodSort.Api.Services;

/// <summary>
/// Public invite card. First name + suburb only — never email or address.
/// </summary>
public static class InvitePreview
{
    public static string PublicFirstName(string? name)
    {
        var first = (name ?? "").Trim()
            .Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault() ?? "";
        if (first.Contains('@') || first.Length is < 2 or > 24) return "A neighbour";
        if (first.Equals("New", StringComparison.OrdinalIgnoreCase)
            || first.Equals("You", StringComparison.OrdinalIgnoreCase))
            return "A neighbour";
        return first;
    }
}
