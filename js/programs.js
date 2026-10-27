/* Undergraduate programs shown in the program picker, grouped by faculty.
   `code` is the program's code on SU's degree pages; the courses that count
   for each program come from data/requirements.js (tools/build_requirements.py). */
window.SU_PROGRAMS = {
  faculties: [
    {
      name: 'Faculty of Engineering and Natural Sciences',
      programs: [
        { id: 'cs', code: 'BSCS', name: 'Computer Science and Engineering' },
        { id: 'dsa', code: 'BSDSA', name: 'Data Science and Analytics' },
        { id: 'ee', code: 'BSEE', name: 'Electronics Engineering' },
        { id: 'ie', code: 'BSMS', name: 'Industrial Engineering' },
        { id: 'mat', code: 'BSMAT', name: 'Materials Science and Nano Engineering' },
        { id: 'me', code: 'BSME', name: 'Mechatronics Engineering' },
        { id: 'bio', code: 'BSBIO', name: 'Molecular Biology, Genetics and Bioengineering' },
      ],
    },
    {
      name: 'Faculty of Arts and Social Sciences',
      programs: [
        { id: 'econ', code: 'BAECON', name: 'Economics' },
        { id: 'psir', code: 'BAPSIR', name: 'Political Science and International Relations' },
        { id: 'psy', code: 'BAPSY', name: 'Psychology' },
        { id: 'vacd', code: 'BAVACD', name: 'Visual Arts and Visual Communications Design' },
      ],
    },
    {
      name: 'Sabancı Business School',
      programs: [
        { id: 'mgmt', code: 'BAMAN', name: 'Management' },
      ],
    },
  ],
};
