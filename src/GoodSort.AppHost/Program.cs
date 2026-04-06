var builder = DistributedApplication.CreateBuilder(args);

// SQL Server (Docker locally, Azure SQL in production)
var sql = builder.AddSqlServer("sql")
    .AddDatabase("goodsortdb");

// .NET API
var api = builder.AddProject<Projects.GoodSort_Api>("api")
    .WithReference(sql)
    .WaitFor(sql)
    .WithExternalHttpEndpoints();

// Next.js frontend (local dev only — production runs on Vercel)
if (builder.ExecutionContext.IsRunMode)
{
    builder.AddNpmApp("frontend", "../../", "dev")
        .WithHttpEndpoint(env: "PORT")
        .WithExternalHttpEndpoints()
        .WithEnvironment("NEXT_PUBLIC_API_URL", api.GetEndpoint("http"));
}

builder.Build().Run();
