using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddHouseholdSuburbStreet : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Street",
                table: "Households",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Suburb",
                table: "Households",
                type: "nvarchar(450)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Households_Suburb",
                table: "Households",
                column: "Suburb");

            migrationBuilder.CreateIndex(
                name: "IX_Households_Suburb_CouncilCollectionDay",
                table: "Households",
                columns: new[] { "Suburb", "CouncilCollectionDay" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Households_Suburb",
                table: "Households");

            migrationBuilder.DropIndex(
                name: "IX_Households_Suburb_CouncilCollectionDay",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "Street",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "Suburb",
                table: "Households");
        }
    }
}
