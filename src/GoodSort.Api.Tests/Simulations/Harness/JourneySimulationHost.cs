using GoodSort.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests.Simulations.Harness;

/// <summary>
/// WebApplicationFactory host configured for isolated, deterministic end-to-end journey simulations.
/// Uses an isolated in-memory database, test JWT secrets, disabled background services,
/// and mocked outbound HTTP clients (Tailor Vision & Brisbane OpenData).
/// </summary>
public class JourneySimulationHost : WebApplicationFactory<Program>
{
    private readonly string _dbName;

    public JourneySimulationHost(string? dbName = null)
    {
        _dbName = dbName ?? $"journey-sim-{Guid.NewGuid():N}";
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);
        builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
        builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
        builder.UseSetting("TAILOR_VISION_API_KEY", "test-tailor-vision-key");

        builder.ConfigureServices(services =>
        {
            // The app registers the context by name; re-register it against
            // an isolated per-factory database.
            services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
            services.RemoveAll<GoodSortDbContext>();
            services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(_dbName));

            // Background loops generate runs and send reminders on timers.
            services.RemoveAll<IHostedService>();

            // Mock outbound HTTP clients for TailorVision and BinDayService
            services.RemoveAll<IHttpClientFactory>();
            services.AddSingleton<IHttpClientFactory, MockHttpClientFactory>();
        });
    }

    /// <summary>
    /// Creates an HttpClient wired with the provided NetworkCaptureHandler.
    /// </summary>
    public HttpClient CreateCapturedClient(NetworkCaptureHandler captureHandler)
    {
        return CreateDefaultClient(captureHandler);
    }

    /// <summary>
    /// Executes an operation on a freshly scoped GoodSortDbContext.
    /// </summary>
    public async Task WithDbContextAsync(Func<GoodSortDbContext, Task> action)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        await action(db);
    }

    /// <summary>
    /// Executes a function on a freshly scoped GoodSortDbContext and returns the result.
    /// </summary>
    public async Task<T> WithDbContextAsync<T>(Func<GoodSortDbContext, Task<T>> func)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        return await func(db);
    }
}
