namespace GoodSort.Api.Services;

/// <summary>
/// Marks a VisionCall row that is holding a slot for a call still in flight.
///
/// The daily spend caps count VisionCalls, and the real row is only written
/// after the upstream call returns — several seconds later, given an 8s Tailor
/// Vision timeout and an Azure OpenAI fallback behind it. Without a placeholder
/// the caps are a check-then-act: concurrent requests all read the same total,
/// all pass, and all get billed.
///
/// The name is shared so the count, the cleanup and any future report of
/// provider mix agree on what a reservation looks like. It deliberately is not
/// one of the real provider names ("tailor", "openai", "none").
/// </summary>
public static class VisionReservation
{
    public const string Provider = "reserved";
}
