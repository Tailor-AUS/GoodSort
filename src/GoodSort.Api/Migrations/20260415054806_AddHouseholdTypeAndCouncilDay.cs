using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddHouseholdTypeAndCouncilDay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BinCapacityLitres",
                table: "Households",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BuildingName",
                table: "Households",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CouncilArea",
                table: "Households",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CouncilCollectionDay",
                table: "Households",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastPickupAt",
                table: "Households",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Type",
                table: "Households",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "UsesDivider",
                table: "Households",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "HouseholdId",
                table: "Bins",
                type: "uniqueidentifier",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BinCapacityLitres",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "BuildingName",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "CouncilArea",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "CouncilCollectionDay",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "LastPickupAt",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "Type",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "UsesDivider",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "Bins");
        }
    }
}
