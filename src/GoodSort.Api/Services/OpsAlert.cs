namespace GoodSort.Api.Services;

/// <summary>
/// Where to ping when a suburb hits the container threshold. Prefers OPS_ALERT_EMAIL,
/// then ADMIN_SEED_EMAIL. No inbox means the unlock still happens — log it.
/// </summary>
public static class OpsAlert
{
    public static string? Inbox(string? opsAlertEmail, string? adminSeedEmail)
    {
        foreach (var raw in new[] { opsAlertEmail, adminSeedEmail })
        {
            var email = raw?.Trim();
            if (!string.IsNullOrWhiteSpace(email) && email.Contains('@')) return email;
        }
        return null;
    }
}
