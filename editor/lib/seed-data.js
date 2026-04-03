/**
 * Canonical Jane Doe seed/demo data.
 * Used by both the backend (db.js seedJaneDoe) and frontend (demo mode).
 */

const JANE_DOE_DATA = {
  personal: {
    firstName: 'Jane', lastName: 'Doe',
    position: 'Senior Software Engineer',
    address: '123 Main Street, Anytown, ST 12345',
    mobile: '(555) 123-4567', email: 'jane.doe@example.com',
    homepage: 'janedoe.dev',
    github: 'janedoe', linkedin: 'janedoe', gitlab: 'janedoe',
    twitter: 'janedoe', orcid: '0000-0001-2345-6789',
    quote: 'Building the future, one commit at a time.',
    photoEnabled: '0', photoFile: '',
  },
  sections: [
    {
      id: 'summary', type: 'cvparagraph', title: 'Summary',
      entries: [{ id: 1, section_id: 'summary', sort_order: 0, resumeIncluded: true,
        fields: { text: 'Experienced software engineer with over 6 years of experience building scalable web applications and distributed systems. Passionate about clean code, mentoring, and continuous learning.' },
        items: [] }]
    },
    {
      id: 'experience', type: 'cventries', title: 'Experience',
      entries: [
        { id: 2, section_id: 'experience', sort_order: 0, resumeIncluded: true,
          fields: { position: 'Senior Software Engineer', organization: 'Acme Technologies', location: 'San Francisco, CA', date: '2022 -- Present' },
          items: [
            { id: 1, entry_id: 2, sort_order: 0, content: 'Led migration of monolithic architecture to microservices, reducing deployment time by 60\\%', resumeIncluded: true, title: 'Microservices migration' },
            { id: 2, entry_id: 2, sort_order: 1, content: 'Mentored team of 4 junior engineers through code reviews and pair programming sessions', resumeIncluded: true, title: 'Team mentoring' },
          ]
        },
        { id: 3, section_id: 'experience', sort_order: 1, resumeIncluded: true,
          fields: { position: 'Software Engineer', organization: 'Widget Corp', location: 'Austin, TX', date: '2019 -- 2022' },
          items: [
            { id: 3, entry_id: 3, sort_order: 0, content: 'Designed and implemented RESTful API serving 10,000 requests per second', resumeIncluded: true, title: 'API design' },
            { id: 4, entry_id: 3, sort_order: 1, content: 'Developed automated testing pipeline reducing QA cycle from 2 weeks to 3 days', resumeIncluded: true, title: 'Testing pipeline' },
          ]
        }
      ]
    },
    {
      id: 'education', type: 'cventries', title: 'Education',
      entries: [
        { id: 4, section_id: 'education', sort_order: 0, resumeIncluded: true,
          fields: { position: 'B.S. Computer Science', organization: 'State University', location: 'Anytown, ST', date: '2015 -- 2019' },
          items: [
            { id: 5, entry_id: 4, sort_order: 0, content: 'Graduated magna cum laude, GPA 3.8/4.0', resumeIncluded: true, title: 'Academic achievement' },
          ]
        }
      ]
    },
    {
      id: 'skills', type: 'cvskills', title: 'Skills',
      entries: [
        { id: 5, section_id: 'skills', sort_order: 0, resumeIncluded: true, fields: { category: 'Languages', skills: 'JavaScript, Python, Go, Rust, SQL' }, items: [] },
        { id: 6, section_id: 'skills', sort_order: 1, resumeIncluded: true, fields: { category: 'Frameworks', skills: 'React, Node.js, Express, Django' }, items: [] },
        { id: 7, section_id: 'skills', sort_order: 2, resumeIncluded: true, fields: { category: 'Tools', skills: 'Docker, Kubernetes, Git, CI/CD, AWS' }, items: [] },
      ]
    },
  ],
  documents: {
    cv: [
      { sectionId: 'summary', enabled: true, sortOrder: 0, resumeParagraphText: null },
      { sectionId: 'experience', enabled: true, sortOrder: 1, resumeParagraphText: null },
      { sectionId: 'education', enabled: true, sortOrder: 2, resumeParagraphText: null },
      { sectionId: 'skills', enabled: true, sortOrder: 3, resumeParagraphText: null },
    ],
    resume: [
      { sectionId: 'summary', enabled: true, sortOrder: 0, resumeParagraphText: 'Software engineer with 6 years of experience in web applications and distributed systems.' },
      { sectionId: 'experience', enabled: true, sortOrder: 1, resumeParagraphText: null },
      { sectionId: 'skills', enabled: true, sortOrder: 2, resumeParagraphText: null },
    ]
  },
  coverletter: {
    recipientName: 'Hiring Manager',
    recipientAddress: '456 Corporate Ave, Business City, ST 67890',
    title: 'Application for Software Engineer Position',
    opening: 'Dear Hiring Manager,',
    closing: 'Sincerely,',
    enclosureLabel: 'Attached',
    enclosureContent: 'Resume, Portfolio',
    sections: [
      { id: 1, sort_order: 0, title: 'Introduction', body: 'I am writing to express my interest in the Software Engineer position at your company. With over six years of experience in building scalable systems, I am confident I would be a strong addition to your team.' },
      { id: 2, sort_order: 1, title: 'Experience', body: 'In my current role at Acme Technologies, I have led the migration of a monolithic application to a microservices architecture, resulting in significant improvements in deployment speed and system reliability.' },
    ]
  }
};

module.exports = { JANE_DOE_DATA };
