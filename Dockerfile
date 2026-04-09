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
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "GoodSort.Api.dll"]
