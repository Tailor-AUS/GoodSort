namespace GoodSort.Api.Services;

/// <summary>
/// Household-facing density email copy. Neighbours must hear "sort today,
/// collection night at 12" — never "wait until we order purple bins".
/// Ops bin-buy mail stays in NotificationService.
/// </summary>
public static class DensityEmailCopy
{
    public const string ConsentRequired = "Tick the box so we can tell you when we collect.";
    public const string StreetRequired = "Pick your suburb and recycling day so we can tell you the collection night.";

    public static string ProgressSubject(string place, string dayName, int needed)
        => $"{place} {dayName}: {needed} more start the collection night";

    public static string ProgressLine(int households, string dayName, string place, int needed)
        => $"<b>{households}</b> household{(households == 1 ? "" : "s")} are now on the {dayName} street list in {place}. <b>{needed}</b> more on that recycling day and we start the collection night.";

    public const string ProgressInviteLine =
        "A neighbour just joined. WhatsApp the street again — that is how a collection night starts.";

    public static string UnlockSubject(string place, string dayName)
        => $"{place} {dayName} can start the collection night";

    public static string UnlockLine(string place, string dayName)
        => $"Twelve households in {place} on {dayName} recycling have joined. That night can start. Keep sorting in your own bags — we will confirm the collection night and may deliver a purple The Good Sort bin.";

    public static string BuildingInviteLine(string place)
        => $"Common-area pickups are phase 2. Houses on the same recycling day in {place} start a collection night first — invite them.";
}
