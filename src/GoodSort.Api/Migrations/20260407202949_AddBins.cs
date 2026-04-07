using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBins : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Scans_Households_HouseholdId",
                table: "Scans");

            migrationBuilder.AlterColumn<Guid>(
                name: "HouseholdId",
                table: "Scans",
                type: "uniqueidentifier",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier");

            migrationBuilder.AddColumn<string>(
                name: "BinCode",
                table: "Scans",
                type: "nvarchar(450)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BinId",
                table: "Scans",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Bins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Code = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Address = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Lat = table.Column<double>(type: "float", nullable: false),
                    Lng = table.Column<double>(type: "float", nullable: false),
                    HostedBy = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    PendingContainers = table.Column<int>(type: "int", nullable: false),
                    PendingValueCents = table.Column<int>(type: "int", nullable: false),
                    EstimatedWeightKg = table.Column<double>(type: "float", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    LastScanAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    LastCollectedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Materials = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Bins", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CashoutRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AmountCents = table.Column<int>(type: "int", nullable: false),
                    Bsb = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    AccountNumber = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    AccountName = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ProcessedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CashoutRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CashoutRequests_Profiles_UserId",
                        column: x => x.UserId,
                        principalTable: "Profiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Scans_BinCode",
                table: "Scans",
                column: "BinCode");

            migrationBuilder.CreateIndex(
                name: "IX_Scans_BinId",
                table: "Scans",
                column: "BinId");

            migrationBuilder.CreateIndex(
                name: "IX_Bins_Code",
                table: "Bins",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Bins_Lat_Lng",
                table: "Bins",
                columns: new[] { "Lat", "Lng" });

            migrationBuilder.CreateIndex(
                name: "IX_Bins_Status",
                table: "Bins",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_CashoutRequests_UserId",
                table: "CashoutRequests",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Scans_Bins_BinId",
                table: "Scans",
                column: "BinId",
                principalTable: "Bins",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Scans_Bins_BinId",
                table: "Scans");

            migrationBuilder.DropTable(
                name: "Bins");

            migrationBuilder.DropTable(
                name: "CashoutRequests");

            migrationBuilder.DropIndex(
                name: "IX_Scans_BinCode",
                table: "Scans");

            migrationBuilder.DropIndex(
                name: "IX_Scans_BinId",
                table: "Scans");

            migrationBuilder.DropColumn(
                name: "BinCode",
                table: "Scans");

            migrationBuilder.DropColumn(
                name: "BinId",
                table: "Scans");

            migrationBuilder.AlterColumn<Guid>(
                name: "HouseholdId",
                table: "Scans",
                type: "uniqueidentifier",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier",
                oldNullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Scans_Households_HouseholdId",
                table: "Scans",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
