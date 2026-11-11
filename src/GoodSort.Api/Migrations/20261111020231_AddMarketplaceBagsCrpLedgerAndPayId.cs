using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMarketplaceBagsCrpLedgerAndPayId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SortedBagId",
                table: "Scans",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ContaminationFlag",
                table: "RunStops",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "DiscrepancyCode",
                table: "RunStops",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DiscrepancyNote",
                table: "RunStops",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ScannedBagCount",
                table: "RunStops",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "CoexDocketRef",
                table: "Runs",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DepotVerifiedContainers",
                table: "Runs",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CoexSchemeId",
                table: "RunnerProfiles",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "CashoutRequests",
                type: "nvarchar(450)",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(max)");

            migrationBuilder.AddColumn<string>(
                name: "PayIdType",
                table: "CashoutRequests",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PayIdValue",
                table: "CashoutRequests",
                type: "nvarchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PayoutMethod",
                table: "CashoutRequests",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "RunSettlementLedgers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RunId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AreaName = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    SettlementMode = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    CoexDocketRef = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    VerifiedContainers = table.Column<int>(type: "int", nullable: false),
                    BagsVerified = table.Column<int>(type: "int", nullable: false),
                    DiscrepancyStops = table.Column<int>(type: "int", nullable: false),
                    CoexRefundBasisPoints = table.Column<long>(type: "bigint", nullable: false),
                    CoexHandlingFeeBasisPoints = table.Column<long>(type: "bigint", nullable: false),
                    GrossRevenueBasisPoints = table.Column<long>(type: "bigint", nullable: false),
                    ProFormaCoexGrossBasisPoints = table.Column<long>(type: "bigint", nullable: false),
                    HouseholdPayoutCents = table.Column<int>(type: "int", nullable: false),
                    ContainerMafiaCents = table.Column<int>(type: "int", nullable: false),
                    RunnerPayoutCents = table.Column<int>(type: "int", nullable: false),
                    TotalPayoutCents = table.Column<int>(type: "int", nullable: false),
                    NetMarginBasisPoints = table.Column<long>(type: "bigint", nullable: false),
                    ProFormaCrpNetMarginBasisPoints = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RunSettlementLedgers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RunSettlementLedgers_Runs_RunId",
                        column: x => x.RunId,
                        principalTable: "Runs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SortedBags",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    HouseholdId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatorProfileId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Stream = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    DeclaredContainers = table.Column<int>(type: "int", nullable: false),
                    LinkedScanCount = table.Column<int>(type: "int", nullable: false),
                    VerifiedContainers = table.Column<int>(type: "int", nullable: true),
                    ContaminationFlag = table.Column<bool>(type: "bit", nullable: false),
                    DiscrepancyCode = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    DiscrepancyNote = table.Column<string>(type: "nvarchar(280)", maxLength: 280, nullable: true),
                    Status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    RunId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    RunStopId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    PickedUpByRunnerId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    KerbAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    PickedUpAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    VerifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SortedBags", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SortedBags_Households_HouseholdId",
                        column: x => x.HouseholdId,
                        principalTable: "Households",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Scans_SortedBagId",
                table: "Scans",
                column: "SortedBagId");

            migrationBuilder.CreateIndex(
                name: "IX_CashoutRequests_Status_PayoutMethod",
                table: "CashoutRequests",
                columns: new[] { "Status", "PayoutMethod" });

            migrationBuilder.CreateIndex(
                name: "IX_RunSettlementLedgers_CreatedAt",
                table: "RunSettlementLedgers",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_RunSettlementLedgers_RunId",
                table: "RunSettlementLedgers",
                column: "RunId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SortedBags_Code",
                table: "SortedBags",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SortedBags_HouseholdId",
                table: "SortedBags",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_SortedBags_RunId",
                table: "SortedBags",
                column: "RunId");

            migrationBuilder.CreateIndex(
                name: "IX_SortedBags_RunStopId",
                table: "SortedBags",
                column: "RunStopId");

            migrationBuilder.CreateIndex(
                name: "IX_SortedBags_Status",
                table: "SortedBags",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RunSettlementLedgers");

            migrationBuilder.DropTable(
                name: "SortedBags");

            migrationBuilder.DropIndex(
                name: "IX_Scans_SortedBagId",
                table: "Scans");

            migrationBuilder.DropIndex(
                name: "IX_CashoutRequests_Status_PayoutMethod",
                table: "CashoutRequests");

            migrationBuilder.DropColumn(
                name: "SortedBagId",
                table: "Scans");

            migrationBuilder.DropColumn(
                name: "ContaminationFlag",
                table: "RunStops");

            migrationBuilder.DropColumn(
                name: "DiscrepancyCode",
                table: "RunStops");

            migrationBuilder.DropColumn(
                name: "DiscrepancyNote",
                table: "RunStops");

            migrationBuilder.DropColumn(
                name: "ScannedBagCount",
                table: "RunStops");

            migrationBuilder.DropColumn(
                name: "CoexDocketRef",
                table: "Runs");

            migrationBuilder.DropColumn(
                name: "DepotVerifiedContainers",
                table: "Runs");

            migrationBuilder.DropColumn(
                name: "CoexSchemeId",
                table: "RunnerProfiles");

            migrationBuilder.DropColumn(
                name: "PayIdType",
                table: "CashoutRequests");

            migrationBuilder.DropColumn(
                name: "PayIdValue",
                table: "CashoutRequests");

            migrationBuilder.DropColumn(
                name: "PayoutMethod",
                table: "CashoutRequests");

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "CashoutRequests",
                type: "nvarchar(max)",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(450)");
        }
    }
}
