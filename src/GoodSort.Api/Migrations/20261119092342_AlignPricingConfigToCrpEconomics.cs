using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AlignPricingConfigToCrpEconomics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "PricingConfigs",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-0000-0000-000000000010"),
                columns: new[] { "BaseCents", "CeilingCents", "FloorCents", "GoldBonus", "PlatinumBonus" },
                values: new object[] { 3, 4, 2, 0, 1 });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "PricingConfigs",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-0000-0000-000000000010"),
                columns: new[] { "BaseCents", "CeilingCents", "FloorCents", "GoldBonus", "PlatinumBonus" },
                values: new object[] { 5, 8, 3, 1, 2 });
        }
    }
}
