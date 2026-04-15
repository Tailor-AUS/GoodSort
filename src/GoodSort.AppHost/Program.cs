var builder = DistributedApplication.CreateBuilder(args);

// SQL Server — local Docker container in dev only.
// In production the API reads the connection string for "goodsortdb" from
// the ConnectionStrings__goodsortdb env var (Azure SQL in rg-goodsort-prod),
// so we don't want Aspire provisioning a SQL container app in Azure.
var api = builder.AddProject<Projects.GoodSort_Api>("api")
    .WithExternalHttpEndpoints();

if (builder.ExecutionContext.IsRunMode)
{
    var sql = builder.AddSqlServer("sql").AddDatabase("goodsortdb");
    api.WithReference(sql).WaitFor(sql);

    // Next.js frontend (local dev only — production runs on Azure Static Web Apps)
    builder.AddNpmApp("frontend", "../../", "dev")
        .WithHttpEndpoint(env: "PORT")
        .WithExternalHttpEndpoints()
        .WithEnvironment("NEXT_PUBLIC_API_URL", api.GetEndpoint("http"));
}

builder.Build().Run();
