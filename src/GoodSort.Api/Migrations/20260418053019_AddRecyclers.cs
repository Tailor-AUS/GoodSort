using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRecyclers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "RecyclerId",
                table: "Runs",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Recyclers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Address = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Lat = table.Column<double>(type: "float", nullable: false),
                    Lng = table.Column<double>(type: "float", nullable: false),
                    AcceptedStreams = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    PricePerKgCents = table.Column<int>(type: "int", nullable: false),
                    MinDeliveryKg = table.Column<int>(type: "int", nullable: false),
                    MaxDeliveryKg = table.Column<int>(type: "int", nullable: false),
                    PaymentTerms = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ContactName = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ContactEmail = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ContactPhone = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    OperatingHours = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Recyclers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Runs_RecyclerId",
                table: "Runs",
                column: "RecyclerId");

            migrationBuilder.AddForeignKey(
                name: "FK_Runs_Recyclers_RecyclerId",
                table: "Runs",
                column: "RecyclerId",
                principalTable: "Recyclers",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Runs_Recyclers_RecyclerId",
                table: "Runs");

            migrationBuilder.DropTable(
                name: "Recyclers");

            migrationBuilder.DropIndex(
                name: "IX_Runs_RecyclerId",
                table: "Runs");

            migrationBuilder.DropColumn(
                name: "RecyclerId",
                table: "Runs");
        }
    }
}
