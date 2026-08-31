namespace GoodSort.Api.Services;

/// <summary>
/// The business day this product runs on.
///
/// The container has no timezone set — the runtime image declares only
/// ASPNETCORE_URLS, GIT_SHA and BUILD_TIME, and nothing sets TZ on the container
/// app — so DateTime.Now is DateTime.UtcNow in production. Brisbane is UTC+10
/// with no daylight saving, which means for the first ten hours of every local
/// day, anything derived from DateTime.Now lands on the previous date.
///
/// That is invisible on a developer machine in Australia, where DateTime.Now is
/// already Brisbane time and the code appears to work.
///
/// A fixed offset rather than TimeZoneInfo on purpose: Queensland does not
/// observe daylight saving, and the tz database id differs between platforms
/// ("Australia/Brisbane" on Linux, "E. Australia Standard Time" on Windows), so
/// a lookup is a runtime failure waiting for the first machine that disagrees.
/// </summary>
public static class BrisbaneTime
{
    /// <summary>UTC+10, year round. Queensland has no daylight saving.</summary>
    public static readonly TimeSpan Offset = TimeSpan.FromHours(10);

    /// <summary>Local wall-clock time in Brisbane.</summary>
    public static DateTime Now => DateTime.UtcNow + Offset;

    /// <summary>Today's date in Brisbane — the business date, not UTC's.</summary>
    public static DateTime Today => Now.Date;

    /// <summary>Brisbane local time for a given UTC instant.</summary>
    public static DateTime FromUtc(DateTime utc) => utc + Offset;
}
