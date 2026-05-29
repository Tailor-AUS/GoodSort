namespace GoodSort.Api.Data.Entities;

public class VisionCall
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Provider { get; set; } = ""; // "tailor" | "openai" | "none"
    public bool Success { get; set; }
    public int ContainerCount { get; set; }
    public int DurationMs { get; set; }
    /// <summary>Profile.Id of the caller. Used for per-user daily-cap enforcement.</summary>
    public Guid? UserId { get; set; }
    /// <summary>Truncated error message (or HTTP status) for failures. Null on success.</summary>
    public string? ErrorSummary { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
