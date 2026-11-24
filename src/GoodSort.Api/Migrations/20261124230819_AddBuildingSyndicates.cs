using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodSort.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBuildingSyndicates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BuildingSyndicates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BuildingKey = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    Suburb = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    BuildingKind = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    PickupStatus = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    DropSpot = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    PickupWindow = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    PickupRequestedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    PickupRequestedByHandle = table.Column<string>(type: "nvarchar(48)", maxLength: 48, nullable: true),
                    OfficialApprovedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BuildingSyndicates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "BuildingSyndicateMembers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SyndicateId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ProfileId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AnonHandle = table.Column<string>(type: "nvarchar(48)", maxLength: 48, nullable: false),
                    Role = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    ReadyToPool = table.Column<bool>(type: "bit", nullable: false),
                    VotedDropSpot = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    VotedPickupWindow = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    JoinedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ApprovedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BuildingSyndicateMembers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BuildingSyndicateMembers_BuildingSyndicates_SyndicateId",
                        column: x => x.SyndicateId,
                        principalTable: "BuildingSyndicates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BuildingSyndicateMembers_Profiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "Profiles",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "BuildingSyndicateMessages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SyndicateId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MemberId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    AnonHandle = table.Column<string>(type: "nvarchar(48)", maxLength: 48, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Body = table.Column<string>(type: "nvarchar(320)", maxLength: 320, nullable: false),
                    Flagged = table.Column<bool>(type: "bit", nullable: false),
                    FlagCount = table.Column<int>(type: "int", nullable: false),
                    Hidden = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BuildingSyndicateMessages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BuildingSyndicateMessages_BuildingSyndicates_SyndicateId",
                        column: x => x.SyndicateId,
                        principalTable: "BuildingSyndicates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BuildingSyndicateMembers_ProfileId",
                table: "BuildingSyndicateMembers",
                column: "ProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_BuildingSyndicateMembers_Status",
                table: "BuildingSyndicateMembers",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_BuildingSyndicateMembers_SyndicateId_ProfileId",
                table: "BuildingSyndicateMembers",
                columns: new[] { "SyndicateId", "ProfileId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BuildingSyndicateMessages_Flagged",
                table: "BuildingSyndicateMessages",
                column: "Flagged");

            migrationBuilder.CreateIndex(
                name: "IX_BuildingSyndicateMessages_SyndicateId_CreatedAt",
                table: "BuildingSyndicateMessages",
                columns: new[] { "SyndicateId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_BuildingSyndicates_BuildingKey",
                table: "BuildingSyndicates",
                column: "BuildingKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BuildingSyndicates_Status",
                table: "BuildingSyndicates",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_BuildingSyndicates_Suburb",
                table: "BuildingSyndicates",
                column: "Suburb");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BuildingSyndicateMembers");

            migrationBuilder.DropTable(
                name: "BuildingSyndicateMessages");

            migrationBuilder.DropTable(
                name: "BuildingSyndicates");
        }
    }
}
