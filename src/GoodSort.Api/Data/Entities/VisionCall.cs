namespace GoodSort.Api.Data.Entities;

public class VisionCall
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Provider { get; set; } = ""; // "tailor" | "openai" | "mock"
    public bool Success { get; set; }
    public int ContainerCount { get; set; }
    public int DurationMs { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
