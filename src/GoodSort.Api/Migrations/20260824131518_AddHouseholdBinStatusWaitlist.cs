using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddHouseholdBinStatusWaitlist : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BinStatus",
                table: "Households",
                type: "nvarchar(450)",
                nullable: false,
                defaultValue: "waitlisted");

            migrationBuilder.AddColumn<DateTime>(
                name: "WaitlistedAt",
                table: "Households",
                type: "datetime2",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Households_BinStatus",
                table: "Households",
                column: "BinStatus");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Households_BinStatus",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "BinStatus",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "WaitlistedAt",
                table: "Households");
        }
    }
}
