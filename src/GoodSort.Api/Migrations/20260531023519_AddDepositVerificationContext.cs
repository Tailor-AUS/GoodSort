using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDepositVerificationContext : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "DepositDistanceM",
                table: "Scans",
                type: "float",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "DepositLat",
                table: "Scans",
                type: "float",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "DepositLng",
                table: "Scans",
                type: "float",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "GeofenceVerified",
                table: "Scans",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "SerialId",
                table: "Scans",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DepositDistanceM",
                table: "Scans");

            migrationBuilder.DropColumn(
                name: "DepositLat",
                table: "Scans");

            migrationBuilder.DropColumn(
                name: "DepositLng",
                table: "Scans");

            migrationBuilder.DropColumn(
                name: "GeofenceVerified",
                table: "Scans");

            migrationBuilder.DropColumn(
                name: "SerialId",
                table: "Scans");
        }
    }
}
