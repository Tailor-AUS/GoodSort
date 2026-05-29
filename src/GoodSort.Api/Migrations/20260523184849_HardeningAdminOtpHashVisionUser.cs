using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class HardeningAdminOtpHashVisionUser : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "Code",
                table: "OtpCodes",
                newName: "CodeHash");

            migrationBuilder.AddColumn<string>(
                name: "ErrorSummary",
                table: "VisionCalls",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "UserId",
                table: "VisionCalls",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsAdmin",
                table: "Profiles",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ErrorSummary",
                table: "VisionCalls");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "VisionCalls");

            migrationBuilder.DropColumn(
                name: "IsAdmin",
                table: "Profiles");

            migrationBuilder.RenameColumn(
                name: "CodeHash",
                table: "OtpCodes",
                newName: "Code");
        }
    }
}
