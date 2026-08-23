-- CreateTable
CREATE TABLE "SchedulePattern" (
    "id" SERIAL NOT NULL,
    "scheduleId" INTEGER NOT NULL,
    "busId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "displaySlot" INTEGER,
    "underlyingSlot" INTEGER NOT NULL,
    "operating" BOOLEAN NOT NULL DEFAULT true,
    "depotGroup" TEXT,

    CONSTRAINT "SchedulePattern_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchedulePattern_scheduleId_date_idx" ON "SchedulePattern"("scheduleId", "date");

-- CreateIndex
CREATE INDEX "SchedulePattern_busId_idx" ON "SchedulePattern"("busId");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulePattern_scheduleId_date_busId_key" ON "SchedulePattern"("scheduleId", "date", "busId");

-- AddForeignKey
ALTER TABLE "SchedulePattern" ADD CONSTRAINT "SchedulePattern_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulePattern" ADD CONSTRAINT "SchedulePattern_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
