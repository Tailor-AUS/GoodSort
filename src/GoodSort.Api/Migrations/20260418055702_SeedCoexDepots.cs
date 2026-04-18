using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class SeedCoexDepots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "Depots",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-0000-0000-000000000001"),
                columns: new[] { "Address", "Lat", "Lng", "Name" },
                values: new object[] { "993 Fairfield Rd, Yeerongpilly QLD 4105", -27.530999999999999, 153.01300000000001, "RECAN Yeerongpilly (Containers for Change)" });

            migrationBuilder.InsertData(
                table: "Depots",
                columns: new[] { "Id", "Address", "CreatedAt", "Lat", "Lng", "Name" },
                values: new object[] { new Guid("00000000-0000-0000-0000-000000000002"), "9/655 Toohey Rd, Salisbury QLD 4107", new DateTime(2026, 4, 1, 0, 0, 0, 0, DateTimeKind.Utc), -27.553000000000001, 153.03399999999999, "Containers for Change Salisbury" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "Depots",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-0000-0000-000000000002"));

            migrationBuilder.UpdateData(
                table: "Depots",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-0000-0000-000000000001"),
                columns: new[] { "Address", "Lat", "Lng", "Name" },
                values: new object[] { "201 Montague Rd, West End", -27.478999999999999, 153.00800000000001, "Tomra South Brisbane" });
        }
    }
}
