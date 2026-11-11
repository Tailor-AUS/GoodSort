using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddProfilePayoutDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BankAccountName",
                table: "Profiles",
                type: "nvarchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankAccountNumber",
                table: "Profiles",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankBsb",
                table: "Profiles",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PayIdType",
                table: "Profiles",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PayIdValue",
                table: "Profiles",
                type: "nvarchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PayoutUpdatedAt",
                table: "Profiles",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PreferredPayoutMethod",
                table: "Profiles",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BankAccountName",
                table: "Profiles");

            migrationBuilder.DropColumn(
                name: "BankAccountNumber",
                table: "Profiles");

            migrationBuilder.DropColumn(
                name: "BankBsb",
                table: "Profiles");

            migrationBuilder.DropColumn(
                name: "PayIdType",
                table: "Profiles");

            migrationBuilder.DropColumn(
                name: "PayIdValue",
                table: "Profiles");

            migrationBuilder.DropColumn(
                name: "PayoutUpdatedAt",
                table: "Profiles");

            migrationBuilder.DropColumn(
                name: "PreferredPayoutMethod",
                table: "Profiles");
        }
    }
}
