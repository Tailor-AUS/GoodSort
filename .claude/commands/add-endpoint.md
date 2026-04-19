Add a new API endpoint to the backend. Argument: description of the endpoint (e.g. "GET /api/users/{id}/stats — return user scan statistics").

## Steps

1. **Check existing patterns**
   - All endpoints live in `src/GoodSort.Api/Program.cs` — do NOT create controllers
   - Follow the minimal API pattern: `app.MapGet`, `app.MapPost`, `app.MapPatch`, `app.MapDelete`
   - Check if a similar endpoint already exists (grep for the resource name)

2. **Implement the endpoint**
   - Add it in `Program.cs` near related endpoints (auth endpoints together, scan endpoints together, etc.)
   - Use dependency injection: `async (RequestType req, GoodSortDbContext db, ServiceName service) =>`
   - For authenticated endpoints, add `.RequireAuthorization()` after the handler
   - Return `Results.Ok(data)`, `Results.NotFound()`, `Results.BadRequest(new { error = "..." })`

3. **If new entity/table needed**
   - Add entity class in `src/GoodSort.Api/Data/Entities/`
   - Add `DbSet` in `GoodSortDbContext.cs`
   - Configure in `OnModelCreating` if needed (indexes, JSON columns, relationships)
   - Generate migration: `dotnet ef migrations add <Name> --project src/GoodSort.Api`
   - Never hand-edit migration files

4. **If new service needed**
   - Add service class in `src/GoodSort.Api/Services/`
   - Register in `Program.cs`: `builder.Services.AddScoped<ServiceName>()`

5. **Frontend integration**
   - Add API call in `lib/store-api.ts` using `apiFetch()` (auto-attaches auth)
   - Or use raw `fetch()` with `getAuthHeaders()` if needed elsewhere

6. **Verify**
   - Build: `dotnet build src/GoodSort.sln -c Release`
   - Test with curl or the `.http` file at `src/GoodSort.Api/GoodSort.Api.http`
