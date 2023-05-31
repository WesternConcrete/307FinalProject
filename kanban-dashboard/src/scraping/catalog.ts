import assert from "assert";
import * as cheerio from "cheerio/lib/slim";
import { z } from "zod";

const DOMAIN = "https://catalog.calpoly.edu";

export const DepartmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  link: z.string().url(),
});
export type Department = z.infer<typeof DepartmentSchema>;

const CollegeSchema = z.object({
  name: z.string(),
  link: z.string().url(),
  departments: z.array(DepartmentSchema),
});
export type College = z.infer<typeof CollegeSchema>;

export const scrapeCollegesAndDepartments = async () => {
  const URL = DOMAIN + "/collegesanddepartments/";
  const page = await fetch(URL).then((res) => res.text());
  const $ = cheerio.load(page);

  const list = $("#textcontainer.page_content");
  const colleges: College[] = [];
  list.find("p").each((_i, elem) => {
    const collegeName = $(elem).text().trim();
    const collegePath = $(elem).find("a").attr("href");
    assert(collegePath, "collegePath is null");
    const collegeLink = DOMAIN + collegePath;
    const departmentList: z.infer<typeof DepartmentSchema>[] = [];
    $(elem)
      .next("ul")
      .find("li>a")
      .each((_i, elem) => {
        const link = DOMAIN + $(elem).attr("href");
        const id = link
          .split("/")
          .findLast((s) => s.length > 0 && !s.startsWith("#"));
        departmentList.push(
          DepartmentSchema.parse({
            name: $(elem).text().trim(),
            link,
            id,
          })
        );
      });
    colleges.push(
      CollegeSchema.parse({
        name: collegeName,
        link: collegeLink,
        departments: departmentList,
      })
    );
  });
  return colleges;
};

export const SubjectCodeSchema = z.string().regex(/[A-Z]+/);
export const SubjectSchema = z.object({
  subject: z.string(),
  code: SubjectCodeSchema,
});
export type Subject = z.infer<typeof SubjectSchema>;

export const scrapeSubjects = async () => {
  const subjectRE = /(.+)\s+\(([A-Z ]+)\)/;

  const URL = "https://catalog.calpoly.edu/coursesaz/";
  const $ = cheerio.load(await fetch(URL).then((res) => res.text()));
  const subjects: Subject[] = [];
  $("a.sitemaplink").each((_i, elem) => {
    const txt = $(elem).text();
    const [_matched, subject, code] = txt.match(subjectRE) ?? [];
    subjects.push(SubjectSchema.parse({ subject, code }));
  });
  return subjects;
};

export const BACHELOR_DEGREE_KINDS = [
  "BA",
  "BFA",
  "BS",
  "BArch",
  "BLA",
] as const;

export const BACHELOR_DEGREE_KIND_NAMES = Object.freeze({
  BA: "Bachelor of Arts",
  BFA: "Bachelor of Fine Arts",
  BS: "Bachelor of Science",
  BArch: "Bachelor of Architecture",
  BLA: "Bachelor of Landscape Architecture",
});

export const RequirementTypeSchema = z.enum([
  "major",
  "elective",
  "ge",
  "support",
]);
export type RequirementType = z.infer<typeof RequirementTypeSchema>;

export const RequirementCourseCodeSchema = z.string();

export const RequirementOneOfSchema: z.ZodType = z.object({
  kind: z.literal("oneof"),
  oneof: z.array(
    RequirementCourseCodeSchema.or(z.lazy(() => RequirementAllOfSchema))
  ),
});
export const RequirementAllOfSchema = z.object({
  kind: z.literal("allof"),
  allof: z.array(RequirementCourseCodeSchema.or(RequirementOneOfSchema)),
});
export const RequirementSchema = z.object({
  kind: RequirementTypeSchema.or(z.string()),
  fulfilledBy: z.array(
    RequirementCourseCodeSchema.or(RequirementAllOfSchema).or(
      RequirementOneOfSchema
    )
  ),
});

export const RequirementCourseSchema = z.object({
  code: z.string(),
  units: z.number(),
  title: z.string(),
});

export type RequirementCourse = z.infer<typeof RequirementCourseSchema>;

export const DegreeSchema = z.object({
  name: z.string(),
  kind: z.enum(BACHELOR_DEGREE_KINDS),
  link: z.string().url(),
  id: z.string(),
  departmentId: z.string(),
});

export type Degree = z.infer<typeof DegreeSchema>;
export const DegreeWithRequirementsSchema = DegreeSchema.extend({
  requirements: z.array(RequirementSchema),
  courses: z.map(z.string(), RequirementCourseSchema),
});
export type DegreeWithRequirements = z.infer<
  typeof DegreeWithRequirementsSchema
>;

export const scrapeDegreeRequirements = async (
  degreeWOReqs: Degree
): Promise<DegreeWithRequirements> => {
  // select from the following
  // If we're in a sftf block the courses are in one of the following formats:
  // a)
  // [course]
  // or [course]
  // or [course]
  // ... until row not starting with "or"
  //
  // b)
  // [course]
  // or
  // [course]
  // or
  // ... until there are two [course] rows not separated by "or" row
  //
  // c)
  // [course]
  // [course]
  // [course]
  // ... until another sftf block or areaheader block (because y tf not)
  //
  // To differentiate these cases the in_sftf flag signifies if we're in a
  // stft block and the sftf_sep is either "or" (for cases a or b) or null (for case c)
  //
  // Note that or conditions can occur OUTSIDE of a sftf block in which
  // case we get our FOURTH and (hopefullly) final option:
  // d)
  // [course]
  // or [course]
  const SFTF_RE = /\s*Select( one sequence)? from the following.*/;

  const degree: DegreeWithRequirements = {
    ...degreeWOReqs,
    requirements: [],
    courses: new Map(),
  };
  const $ = cheerio.load(await fetch(degree.link).then((res) => res.text()));

  const tables = $("table.sc_courselist");

  const requirements = degree.requirements;
  const courses = degree.courses;

  tables.each((_ti, table) => {
    const table_desc = $(table).prevAll().filter("h2").first().text();
    if (table_desc !== "Degree Requirements and Curriculum") {
      console.warn("Parsing table of unrecognized kind:", table_desc);
    }

    let cur_section: string | null = null;
    // within a select from the following block
    // see comment at top of file which explains these flags
    let in_sftf = false;
    let sftf_sep = null;
    let prev_was_or = false;
    const rows = $(table).find("tr");
    for (let i = 0; i < rows.length; i++) {
      const tr = rows[i];
      // TODO: extracting <sup>1</sup> footnote tags

      if ($(tr).hasClass("areaheader")) {
        in_sftf = false;
        prev_was_or = false;
        sftf_sep = null;
        // new section
        const cur_section_title = $(tr).text().trim();
        if (cur_section_title.includes("MAJOR COURSES")) {
          cur_section = "major";
        } else if (cur_section_title.includes("Electives")) {
          // FIXME: include the type of elective
          cur_section = "elective";
        } else if (cur_section_title.includes("GENERAL EDUCATION")) {
          cur_section = "ge";
        } else if (cur_section_title.includes("SUPPORT COURSES")) {
          cur_section = "support";
        } else {
          cur_section = cur_section_title as RequirementType;
          // console.log("Unrecognized section kind for", cur_section_title);
        }
        if (!cur_section) {
          console.error("no text in header:", $(tr));
          break;
        }
      } else if ($(tr).find("span.courselistcomment").length > 0) {
        const comment = $(tr).find("span.courselistcomment").text().trim();
        if (comment.match(SFTF_RE)) {
          in_sftf = true;
          requirements.push({ or: [] });
          sftf_sep = null;
        } else if (comment === "or") {
          if (!in_sftf) {
            console.warn(
              "Found an \"or\" row outside of 'Select from the following' block. There's even more variations :/",
              "in",
              degree.name,
              "(",
              degree.link,
              ")",
              comment
            );
            break;
          }
          sftf_sep = "or";
          prev_was_or = true;
        } else {
          console.error("unrecognized comment:", comment);
        }
      } else {
        const course_elem = $(tr).find("td.codecol a[title]");
        let course: any; // TODO: type this
        const is_and = course_elem.length > 1;
        if (is_and) {
          // course is actually courses plural
          // make sure it's actually an '&' of the courses
          if (!$(tr).find("span.blockindent").text().includes("&")) {
            console.error(
              "multiple elements found but no & to be found in:",
              $(tr)
            );
          }
          const course_codes: string[] = [];
          $(course_elem).each((_i, c) => {
            course_codes.push($(c).text().trim());
          });
          const course_titles = [];
          const titles = $(tr).find("td:not([class])");
          $(titles)
            .contents()
            .each((i, t) => {
              if (t.type === "text" && i === 0) {
                course_titles.push($(t).text().trim());
              } else if (t.type === "tag" && t.name === "span") {
                course_titles.push($(t).text().trim().replace(/^and /, ""));
              }
            });
          if (course_codes.length !== course_titles.length) {
            console.warn(
              "found different length code,title lists in and block:",
              { course_titles, course_codes },
              "in",
              degree.name
            );
          } else if (course_titles.length === 0) {
            console.warn(
              "didnt find any titles for course list:",
              course_codes
            );
          } else {
            course_codes.map((code, i) => {
              courses.set(code, {
                code,
                title: course_titles[i],
                units: 0, // TODO: total units
              });
            });
          }

          course = { and: course_codes };
        } else if (course_elem.length !== 1) {
          if ($(tr).hasClass("listsum")) {
            continue;
          }
          // TODO: handle sections with references to other information on page
          console.log("no title for:", $(tr).find("td.codecol").text().trim());
        }
        if (!is_and && course_elem.length === 1) {
          course = course_elem.text().trim();
        }
        const has_orclass = $(tr).hasClass("orclass");
        const last = requirements.length - 1;

        if (in_sftf) {
          const last_or = requirements[last].or;
          if (last_or.length === 0) {
            last_or.push(course);
          } else if (last_or.length >= 1) {
            if (last_or.length === 1 && has_orclass) {
              sftf_sep = "or";
            }
            if (has_orclass || prev_was_or || sftf_sep == null) {
              requirements[last].or.push(course);
            } else {
              in_sftf = false;
              sftf_sep = null;
            }
          }
          prev_was_or = false;
        }
        if (!in_sftf && has_orclass) {
          // TODO: assert data.cur.last is not or already
          // (multiple or's chained togehter outside of sftf)
          requirements[last] = {
            or: [requirements[last], course],
          };
        } else if (!in_sftf) {
          // Normal row
          requirements.push(course);
        }
        if (typeof course === "string") {
          const title = $(tr).find("td:not([class])").text().trim();
          // TODO: more accurate units when in or/and block
          const unitsStr = $(tr).find("td.hourscol").text().trim() || 0;
          const units = parseInt(unitsStr);
          const code = course;
          const courseObj = RequirementCourseSchema.parse({
            title,
            units,
            code,
          });
          courses.set(code, courseObj);
        }
      }
    }
    // TODO: Parse GE table
    // (returning false prevents it from being parsed by ending the iteration after the first table)
    return false;
  });
  // NOTE: it is expected that information from crosslistings can be parsed in subject course lists and handled properly when using degree course requirements
  // const crossListedCourses = new Map();
  // TODO: use non-crosslisted code when inserting course into courses, requirements instead of having postProcess loop
  const crossListedCourses = new Map();
  courses.forEach((req, code) => {
    const codeWOCrosslist = code.replace(/\/[A-Z]+/, "");
    req.code = codeWOCrosslist;
    crossListedCourses.set(code, req);
  });
  crossListedCourses.forEach((req, crossListedCourseCode) => {
    courses.delete(crossListedCourseCode);
    courses.set(req.code, req);
  });

  // TODO: check for correctness by counting the units and comparing to the degree's unit count

  return degree;
};

export const scrapeDegrees = async () => {
  const URL = "https://catalog.calpoly.edu/programsaz/";
  const $ = cheerio.load(await fetch(URL).then((res) => res.text()));
  const majorRE = /(.+),\s+(B\w+)/;
  const degrees: Degree[] = [];
  $("a[name=bachelordegrees]")
    .nextUntil("a[name=concentrations]")
    .filter("p.plist:has(a[href])") // only <a> with href
    .each((i, elem) => {
      const [_matched, name, kind] = $(elem).text().match(majorRE) ?? [];
      const link = DOMAIN + $(elem).find("a").attr("href");
      const id =
        link.split("/").findLast((s) => s.length > 0 && !s.startsWith("#")) ??
        "";
      degrees.push(DegreeSchema.parse({ name, kind, link, id }));
      const linkSegments = link
        .split("/")
        .filter((s) => s.length > 0 && !s.startsWith("#"));
      const id = linkSegments.at(-1);
      const departmentId = linkSegments.at(-2);
      degrees.push(DegreeSchema.parse({ name, kind, link, id, departmentId }));
    });
  return degrees;
};

const TermSchema = z.enum(["F", "W", "SP", "SU", "TBD"]);

const CourseSchema = z.object({
  code: z.string(),
  title: z.string(),
  subject: z.string(),
  num: z.number(),
  description: z.string(),
  termsTypicallyOffered: z.array(TermSchema),
  // if not range minUnits is maxUnits
  minUnits: z.number(),
  maxUnits: z.number(),
});

type Course = z.infer<typeof CourseSchema>;

export const scrapeSubjectCourses = async (subjectCode: string) => {
  const COURSE_INFO_RE = /(([A-Z]+)\s+(\d+))\. (.*?)\.?$/;
  const URL = `https://catalog.calpoly.edu/coursesaz/${subjectCode.toLowerCase()}/`;
  const $ = cheerio.load(await fetch(URL).then((res) => res.text()));

  const courses = $(".courseblock");
  const scrapedCourses: Course[] = [];
  courses.each((i, course) => {
    const title_block = $(course).find(".courseblocktitle");
    const units_str = $(title_block).find("strong span").text().trim();
    let minUnits = 0,
      maxUnits = 0;
    const units_num = units_str.replace(" units", "");
    if (units_num.includes("-")) {
      const [minUnits, maxUnits] = units_num.split("-").map(Number);
    } else {
      let units = parseInt(units_num);
      minUnits = units;
      maxUnits = units;
    }
    const [_, code, subject, numStr, title] =
      $(title_block)
        .find("strong")
        .text()
        .replace(units_str, "")
        .trim()
        .match(COURSE_INFO_RE) ?? [];
    const num = parseInt(numStr);
    const info_block = $(course).find(".courseextendedwrap");
    let termsTypicallyOffered = null;
    $(info_block)
      .find("p")
      .each((i, info_field) => {
        const field_text = $(info_field).text().trim();
        if (field_text.startsWith("Term Typically Offered:")) {
          const terms_offered = field_text
            .replace("Term Typically Offered: ", "")
            .split(/, ?/);
          termsTypicallyOffered = terms_offered;
        }
        // TODO: "catolog:" field specifying the requirements it fulfills
        // TODO: "CR/NC" field
      });
    const description = $(course).find(".courseblockdesc").text().trim()
    scrapedCourses.push(
      CourseSchema.parse({
        subject,
        num,
        code,
        title,
        termsTypicallyOffered,
        minUnits,
        maxUnits,
        description,
      })
    );
  });
  return scrapedCourses;
};
