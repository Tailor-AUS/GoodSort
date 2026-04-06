namespace GoodSort.Api.Data.Entities;

public class Depot
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
