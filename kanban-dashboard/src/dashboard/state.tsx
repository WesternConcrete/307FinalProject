import React, {
  useState,
  useEffect,
  createContext,
  useContext,
  type FC,
  type SetStateAction,
  type Dispatch,
} from "react";

import { type Requirement, type Degree } from "~/server/api/root";
import { api } from "~/utils/api";

type Setter<S> = React.Dispatch<React.SetStateAction<S>>;

type FlowchartStateType = {
  requirements: Requirement[];
  setRequirements: Setter<Requirement[]>;
  degree: Degree | null;
  setDegree: Setter<Degree | null>;
  startYear: number;
  setStartYear: Setter<number>;
  selectedRequirements: number[];
  setSelectedRequirements: Setter<number[]>;
  studentYear: 'Freshman' | 'Sophomore' | 'Junior' | 'Senior';
  setStudentYear:  Setter<'Freshman' | 'Sophomore' | 'Junior' | 'Senior'>;
  studentTerm: 'Winter' | 'Spring' | 'Fall';
  setStudentTerm: Setter< 'Winter' | 'Spring' | 'Fall'>;
  indexMap: Record<string, number>;
  setIndexMap: Setter<Record<string, number>>;

};

export const STUDENT_YEAR_OPTIONS = ['Freshman' , 'Sophomore' , 'Junior' , 'Senior'] as ('Freshman' | 'Sophomore' | 'Junior' | 'Senior')[];

export const STUDENT_TERM_OPTIONS = ['Winter' , 'Spring',  'Fall'] as ('Winter' | 'Spring' | 'Fall')[]

export const FlowchartState = createContext<FlowchartStateType>(
  {} as FlowchartStateType
);

export const FlowchartStateProvider: FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // TODO: remove requirements state and replace with trpc query
  // TODO: remove StoreProvider and replace with trpc quarters query in flowchart
  // TODO: merge dashboard and flowhcart components
  // TODO: make moveRequirement a backend mutation
  const [studentYear, setStudentYear] = useState<'Freshman' | 'Sophomore' | 'Junior' | 'Senior'>("Freshman");

  const currentMonth = new Date().getMonth();

  let currentSeason: 'Winter' | 'Spring' | 'Fall';
  if (currentMonth < 3) currentSeason = 'Winter';
  else if (currentMonth < 6) currentSeason = 'Spring';
  else currentSeason = 'Fall';

  const [studentTerm, setStudentTerm] = useState<'Winter' | 'Spring' | 'Fall'>(currentSeason);

  const [indexMap, setIndexMap] = useState<Record<string, number>>({});
  
  const [degree, setDegree] = useState<Degree | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);

  const [selectedRequirements, setSelectedRequirements] = useState<number[]>(
    []
  );

  // default to current year
  // TODO: create way to select start year
  const [startYear, setStartYear] = useState<number>(new Date().getFullYear());
  useEffect(() => {
    console.log("updating requirements!");
  }, [requirements]);
  const _requirementsQuery = api.degreeRequirements.useQuery(
    { degree, startYear },
    { enabled: false, onSuccess: (data) => setRequirements(data) }
  );
  const flowchartContext = {
    degree,
    setDegree,
    requirements,
    setRequirements,
    startYear,
    setStartYear,
    selectedRequirements,
    setSelectedRequirements,
    studentYear,
    setStudentYear,
    studentTerm,
    setStudentTerm,
    indexMap, 
    setIndexMap,
  };

  // TODO: move nested courses fetch here to avoid loading spinner waterfall

  return (
    <FlowchartState.Provider value={flowchartContext}>
      {children}
    </FlowchartState.Provider>
  );
};

export const useMoveRequirement = () => {
  const { degree, startYear } = useContext(FlowchartState);
  const trpcClient = api.useContext();
  const moveRequirement = (requirementId: number, quarterId: number) => {
    trpcClient.degreeRequirements.setData(
      { degree, startYear },
      (requirements) => {
        if (!requirements) {
          console.error("No requirements found for degree:", degree);
          return [];
        }
        let found = false;
        const newRequirements = requirements.map((r) => {
          if (r.id === requirementId) {
            found = true;
            console.log("moving:", r, "to:", quarterId);
            r.quarterId = quarterId;
          }
          return r;
        });
        if (!found) {
          console.error(
            `Tried to move requirement with id: ${requirementId} but couldn't find it...`
          );
        }
        return newRequirements;
      }
    );
  };
  return moveRequirement;
};

export const DraggingState = React.createContext({
  // existing state and functions...
  dragging: false,
  setDragging: (() => {}) as unknown as Dispatch<SetStateAction<boolean>>,
  draggingItem: null,
  setDraggingItem: (() => {}) as unknown as Dispatch<SetStateAction<null>>,
  draggingOver: null,
  setDraggingOver: (() => {}) as unknown as Dispatch<SetStateAction<null>>,
});
