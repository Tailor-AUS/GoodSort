FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY src/GoodSort.Api/GoodSort.Api.csproj GoodSort.Api/
COPY src/GoodSort.ServiceDefaults/GoodSort.ServiceDefaults.csproj GoodSort.ServiceDefaults/
RUN dotnet restore GoodSort.Api/GoodSort.Api.csproj
COPY src/GoodSort.Api/ GoodSort.Api/
COPY src/GoodSort.ServiceDefaults/ GoodSort.ServiceDefaults/
RUN dotnet publish GoodSort.Api/GoodSort.Api.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /app .

# Which commit is actually serving. The image is already tagged with the sha,
# but a tag is only visible to whoever can read the registry - the running app
# could not say what it was, so a deploy could only be verified by trusting
# that a green workflow run reached production. Declared in the runtime stage
# so a rebuild of the same source with a new sha does not bust the build cache.
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "GoodSort.Api.dll"]
