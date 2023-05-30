import { t } from "~/server/api/trpc";
import {
  scrapeDegrees,
  scrapeDegreeRequirements,
  type RequirementCourse,
  DegreeSchema,
  RequirementTypeSchema,
} from "~/scraping/catalog";
export type {
  Degree,
  RequirementCourse,
  RequirementTypeSchema,
} from "~/scraping/catalog";
import { z } from "zod";
import {
  TERM_NUMBER,
  type Term,
  scrapeCurrentQuarter,
  termCode,
} from "~/scraping/registrar";
import { prisma } from "~/server/db";

const courseType_arr = RequirementTypeSchema.options;

const YearSchema = z
  .number()
  .gte(0, { message: "year < 0" })
  .lt(4, { message: "year >= 4" });
const SchoolYearTermSchema = z.union([
  z.literal(2),
  z.literal(4),
  z.literal(8),
]);

const RequirementSchema = z.object({
  code: z.string(), // TODO: validate course code
  id: z.number(),
  title: z.string(),
  courseType: RequirementTypeSchema,
  units: z.number().nonnegative(),
  quarterId: z.number().gte(2000, { message: "term code < 2000" }), // see termCode function in scraping/registrar.ts for details
});
export type Requirement = z.infer<typeof RequirementSchema>;

const QuarterSchema = z.object({
  id: z.number().gte(2000, { message: "term code < 2000" }), // see termCode function in scraping/registrar.ts for details
  year: YearSchema,
  termNum: SchoolYearTermSchema,
});
export type Quarter = z.infer<typeof QuarterSchema>;
/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = t.router({
  quarters: t.router({
    current: t.procedure.output(z.number().gt(2000)).query(async () => {
      return await scrapeCurrentQuarter();
    }),
    all: t.procedure
      .input(z.object({ startYear: z.number().gte(2000) }))
      .query(({ input: { startYear } }) => {
        const quarters = [];

        let calYear = startYear;
        let schoolYear = 0;

        const q = (termSeason: Term) => ({
          id: termCode(calYear, termSeason),
          termNum: TERM_NUMBER[termSeason] as z.infer<
            typeof SchoolYearTermSchema
          >,
          year: schoolYear,
        });
        while (schoolYear < 4) {
          // winter/spring quarter will be in yeear 5 senior year but this is still 4th year

          quarters.push(q("fall"));
          calYear++;
          quarters.push(q("winter"));
          quarters.push(q("spring"));
          schoolYear++;
        }
        return quarters;
      }),
  }),
  degreeRequirements: t.procedure
    .input(
      z.object({
        degree: DegreeSchema.nullable(),
        startYear: z.number().gte(2000),
      })
    )
    .output(z.array(RequirementSchema))
    .query(async ({ input }) => {
      if (input.degree === null) {
        return [];
      }
      const courses = await scrapeDegreeRequirements(input.degree);
      // generate random info for the data that isn't being scraped yet
      return Array.from(courses.courses.values()).map(
        (course: RequirementCourse, i) => ({
          ...course,
          courseType:
            courseType_arr[Math.floor(Math.random() * courseType_arr.length)], // TODO: figure out course type from group
          quarterId: termCode(
            Math.floor(Math.random() * 4) + input.startYear,
            SchoolYearTermSchema.parse([2, 4, 8][Math.floor(Math.random() * 3)])
          ),
          id: i,
        })
      );
    }),
  degrees: t.procedure.query(async () => {
    let degrees = await prisma.degree.findMany();
    if (degrees.length === 0) {
      // TODO: invalidation of db data
      degrees = await scrapeDegrees();
      await prisma.degree.createMany({ data: degrees });
    }
    return degrees;
  }),
});

// export type definition of API
export type AppRouter = typeof appRouter;
