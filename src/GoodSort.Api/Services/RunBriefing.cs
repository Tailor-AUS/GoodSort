using System.Linq.Expressions;
using GoodSort.Api.Data.Entities;

namespace GoodSort.Api.Services;

/// <summary>
/// Which claimed runs still need tomorrow's briefing email.
///
/// The nightly pass used to select every claimed run with no date bound, stamp
/// nothing, and never call SaveChanges — so a run a runner claimed and did not
/// start produced one briefing email per night, indefinitely. Nothing capped
/// it: a Run has ExpiresAt for the unclaimed window, but once claimed there is
/// no expiry and no reclaim, so "claimed and abandoned" is a state a row can
/// sit in forever.
///
/// The rule lives here rather than inline so the test asserts on the same
/// expression the service runs. A test carrying its own copy of a predicate is
/// the drift this codebase keeps paying for elsewhere.
/// </summary>
public static class RunBriefing
{
    /// <summary>
    /// Claimed, assigned, and not already briefed for this local day. Translated
    /// to SQL, so it must stay expression-friendly — no helper method calls.
    /// </summary>
    public static Expression<Func<Run, bool>> Due(DateTime todayLocal) =>
        r => r.Status == "claimed"
             && r.RunnerId != null
             && (r.LastBriefedAt == null || r.LastBriefedAt < todayLocal);

    /// <summary>Every claimed run, briefed today or not. Used by the manual trigger.</summary>
    public static Expression<Func<Run, bool>> All() =>
        r => r.Status == "claimed" && r.RunnerId != null;
}
