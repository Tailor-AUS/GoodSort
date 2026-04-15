using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVisionCalls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "VisionCalls",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Provider = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Success = table.Column<bool>(type: "bit", nullable: false),
                    ContainerCount = table.Column<int>(type: "int", nullable: false),
                    DurationMs = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VisionCalls", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VisionCalls_CreatedAt",
                table: "VisionCalls",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_VisionCalls_Provider",
                table: "VisionCalls",
                column: "Provider");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "VisionCalls");
        }
    }
}
