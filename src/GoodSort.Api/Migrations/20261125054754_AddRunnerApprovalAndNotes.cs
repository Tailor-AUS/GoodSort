using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRunnerApprovalAndNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AdminNote",
                table: "RunnerProfiles",
                type: "nvarchar(280)",
                maxLength: 280,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ApprovalStatus",
                table: "RunnerProfiles",
                type: "nvarchar(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "approved");

            migrationBuilder.AddColumn<DateTime>(
                name: "ApprovedAt",
                table: "RunnerProfiles",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SuspendedAt",
                table: "RunnerProfiles",
                type: "datetime2",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_RunnerProfiles_ApprovalStatus",
                table: "RunnerProfiles",
                column: "ApprovalStatus");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RunnerProfiles_ApprovalStatus",
                table: "RunnerProfiles");

            migrationBuilder.DropColumn(
                name: "AdminNote",
                table: "RunnerProfiles");

            migrationBuilder.DropColumn(
                name: "ApprovalStatus",
                table: "RunnerProfiles");

            migrationBuilder.DropColumn(
                name: "ApprovedAt",
                table: "RunnerProfiles");

            migrationBuilder.DropColumn(
                name: "SuspendedAt",
                table: "RunnerProfiles");
        }
    }
}
