var builder = DistributedApplication.CreateBuilder(args);

// Production environment variables (JWT_SECRET, Tailor Vision key, ACS, Azure
// OpenAI, DB connection) are applied directly to the Container App spec via
// an azd postdeploy hook (see azure.yaml + infra/restore-secrets.sh). This
// avoids the Aspire/azd limitation where manually-set env vars get stripped
// on each `azd deploy`.
var api = builder.AddProject<Projects.GoodSort_Api>("api")
    .WithExternalHttpEndpoints();

if (builder.ExecutionContext.IsRunMode)
{
    // Local dev: spin up SQL in Docker
    var sql = builder.AddSqlServer("sql").AddDatabase("goodsortdb");
    api.WithReference(sql).WaitFor(sql);

    // Next.js frontend (local dev only — production runs on Azure Static Web Apps)
    builder.AddNpmApp("frontend", "../../", "dev")
        .WithHttpEndpoint(env: "PORT")
        .WithExternalHttpEndpoints()
        .WithEnvironment("NEXT_PUBLIC_API_URL", api.GetEndpoint("http"));
}

builder.Build().Run();
