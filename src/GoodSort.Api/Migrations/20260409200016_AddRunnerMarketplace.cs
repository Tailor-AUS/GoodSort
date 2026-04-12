using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRunnerMarketplace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PricingConfigs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FloorCents = table.Column<int>(type: "int", nullable: false),
                    CeilingCents = table.Column<int>(type: "int", nullable: false),
                    BaseCents = table.Column<int>(type: "int", nullable: false),
                    DistanceEfficiencyWeight = table.Column<double>(type: "float", nullable: false),
                    BinDensityWeight = table.Column<double>(type: "float", nullable: false),
                    SupplyDemandWeight = table.Column<double>(type: "float", nullable: false),
                    TimeOfDayWeight = table.Column<double>(type: "float", nullable: false),
                    MaterialMixWeight = table.Column<double>(type: "float", nullable: false),
                    ScrapPriceWeight = table.Column<double>(type: "float", nullable: false),
                    MorningSurge = table.Column<double>(type: "float", nullable: false),
                    AfternoonNormal = table.Column<double>(type: "float", nullable: false),
                    EveningSurge = table.Column<double>(type: "float", nullable: false),
                    NightDiscount = table.Column<double>(type: "float", nullable: false),
                    BronzeBonus = table.Column<int>(type: "int", nullable: false),
                    SilverBonus = table.Column<int>(type: "int", nullable: false),
                    GoldBonus = table.Column<int>(type: "int", nullable: false),
                    PlatinumBonus = table.Column<int>(type: "int", nullable: false),
                    AluminiumSpotCents = table.Column<int>(type: "int", nullable: false),
                    PetSpotCents = table.Column<int>(type: "int", nullable: false),
                    GlassSpotCents = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PricingConfigs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RunnerProfiles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ProfileId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    VehicleType = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CapacityBags = table.Column<int>(type: "int", nullable: false),
                    ServiceRadiusKm = table.Column<double>(type: "float", nullable: false),
                    IsOnline = table.Column<bool>(type: "bit", nullable: false),
                    LastLat = table.Column<double>(type: "float", nullable: true),
                    LastLng = table.Column<double>(type: "float", nullable: true),
                    LastLocationAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    Rating = table.Column<double>(type: "float", nullable: false),
                    TotalRatings = table.Column<int>(type: "int", nullable: false),
                    Level = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    TotalRuns = table.Column<int>(type: "int", nullable: false),
                    TotalContainersCollected = table.Column<int>(type: "int", nullable: false),
                    CurrentStreakDays = table.Column<int>(type: "int", nullable: false),
                    LongestStreakDays = table.Column<int>(type: "int", nullable: false),
                    LastRunCompletedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    EfficiencyScore = table.Column<double>(type: "float", nullable: false),
                    Badges = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    LifetimeEarningsCents = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RunnerProfiles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RunnerProfiles_Profiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "Profiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Runs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    RunnerId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    DropPointId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CentroidLat = table.Column<double>(type: "float", nullable: false),
                    CentroidLng = table.Column<double>(type: "float", nullable: false),
                    AreaName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    EstimatedContainers = table.Column<int>(type: "int", nullable: false),
                    ActualContainers = table.Column<int>(type: "int", nullable: false),
                    PerContainerCents = table.Column<int>(type: "int", nullable: false),
                    EstimatedPayoutCents = table.Column<int>(type: "int", nullable: false),
                    ActualPayoutCents = table.Column<int>(type: "int", nullable: false),
                    PricingTier = table.Column<int>(type: "int", nullable: false),
                    LastPricedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    EstimatedDistanceKm = table.Column<double>(type: "float", nullable: false),
                    EstimatedDurationMin = table.Column<int>(type: "int", nullable: false),
                    ActualDistanceKm = table.Column<double>(type: "float", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ClaimedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    StartedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeliveredAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    SettledAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Materials = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Runs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Runs_Depots_DropPointId",
                        column: x => x.DropPointId,
                        principalTable: "Depots",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Runs_RunnerProfiles_RunnerId",
                        column: x => x.RunnerId,
                        principalTable: "RunnerProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "RunnerRatings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RunId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RunnerId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PickupCompleteness = table.Column<double>(type: "float", nullable: false),
                    Timeliness = table.Column<double>(type: "float", nullable: false),
                    BagCondition = table.Column<double>(type: "float", nullable: false),
                    OverallScore = table.Column<double>(type: "float", nullable: false),
                    Stars = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RunnerRatings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RunnerRatings_RunnerProfiles_RunnerId",
                        column: x => x.RunnerId,
                        principalTable: "RunnerProfiles",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_RunnerRatings_Runs_RunId",
                        column: x => x.RunId,
                        principalTable: "Runs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RunStops",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RunId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BinId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PickupInstruction = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Lat = table.Column<double>(type: "float", nullable: false),
                    Lng = table.Column<double>(type: "float", nullable: false),
                    EstimatedContainers = table.Column<int>(type: "int", nullable: false),
                    ActualContainers = table.Column<int>(type: "int", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    ArrivedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    PickedUpAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    PhotoUrl = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Materials = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RunStops", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RunStops_Bins_BinId",
                        column: x => x.BinId,
                        principalTable: "Bins",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_RunStops_Runs_RunId",
                        column: x => x.RunId,
                        principalTable: "Runs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "PricingConfigs",
                columns: new[] { "Id", "AfternoonNormal", "AluminiumSpotCents", "BaseCents", "BinDensityWeight", "BronzeBonus", "CeilingCents", "CreatedAt", "DistanceEfficiencyWeight", "EveningSurge", "FloorCents", "GlassSpotCents", "GoldBonus", "IsActive", "MaterialMixWeight", "MorningSurge", "NightDiscount", "PetSpotCents", "PlatinumBonus", "ScrapPriceWeight", "SilverBonus", "SupplyDemandWeight", "TimeOfDayWeight", "UpdatedAt" },
                values: new object[] { new Guid("00000000-0000-0000-0000-000000000010"), 1.0, 120, 5, 0.20000000000000001, 0, 8, new DateTime(2026, 4, 1, 0, 0, 0, 0, DateTimeKind.Utc), 0.20000000000000001, 1.1000000000000001, 3, 5, 1, true, 0.10000000000000001, 1.3, 0.69999999999999996, 30, 2, 0.14999999999999999, 0, 0.25, 0.10000000000000001, null });

            migrationBuilder.CreateIndex(
                name: "IX_PricingConfigs_IsActive",
                table: "PricingConfigs",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_RunnerProfiles_IsOnline",
                table: "RunnerProfiles",
                column: "IsOnline");

            migrationBuilder.CreateIndex(
                name: "IX_RunnerProfiles_Level",
                table: "RunnerProfiles",
                column: "Level");

            migrationBuilder.CreateIndex(
                name: "IX_RunnerProfiles_ProfileId",
                table: "RunnerProfiles",
                column: "ProfileId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RunnerRatings_RunId",
                table: "RunnerRatings",
                column: "RunId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RunnerRatings_RunnerId",
                table: "RunnerRatings",
                column: "RunnerId");

            migrationBuilder.CreateIndex(
                name: "IX_Runs_CentroidLat_CentroidLng",
                table: "Runs",
                columns: new[] { "CentroidLat", "CentroidLng" });

            migrationBuilder.CreateIndex(
                name: "IX_Runs_DropPointId",
                table: "Runs",
                column: "DropPointId");

            migrationBuilder.CreateIndex(
                name: "IX_Runs_ExpiresAt",
                table: "Runs",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_Runs_RunnerId",
                table: "Runs",
                column: "RunnerId");

            migrationBuilder.CreateIndex(
                name: "IX_Runs_Status",
                table: "Runs",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_RunStops_BinId",
                table: "RunStops",
                column: "BinId");

            migrationBuilder.CreateIndex(
                name: "IX_RunStops_RunId",
                table: "RunStops",
                column: "RunId");

            migrationBuilder.CreateIndex(
                name: "IX_RunStops_Status",
                table: "RunStops",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PricingConfigs");

            migrationBuilder.DropTable(
                name: "RunnerRatings");

            migrationBuilder.DropTable(
                name: "RunStops");

            migrationBuilder.DropTable(
                name: "Runs");

            migrationBuilder.DropTable(
                name: "RunnerProfiles");
        }
    }
}
