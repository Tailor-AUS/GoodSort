using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddConsentAndBinOut : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AccessConsent",
                table: "Households",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "AccessConsentAt",
                table: "Households",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BinIsOut",
                table: "Households",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "BinIsOutAt",
                table: "Households",
                type: "datetime2",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AccessConsent",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "AccessConsentAt",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "BinIsOut",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "BinIsOutAt",
                table: "Households");
        }
    }
}
