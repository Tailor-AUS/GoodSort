namespace GoodSort.Api.Data.Entities;

public class RunnerRating
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RunId { get; set; }
    public Run Run { get; set; } = null!;

    public Guid RunnerId { get; set; }
    public RunnerProfile Runner { get; set; } = null!;

    // Component scores (0.0 - 1.0)
    public double PickupCompleteness { get; set; } // stops picked up / total stops
    public double Timeliness { get; set; }          // within estimated duration × 1.25
    public double BagCondition { get; set; } = 1.0; // 1.0 minus 0.25 per contamination report

    // Weighted overall: 40% completeness + 30% timeliness + 30% condition
    public double OverallScore { get; set; }

    // Mapped to 1-5 stars for display
    public int Stars { get; set; } = 5;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
