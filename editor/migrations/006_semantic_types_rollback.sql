-- Manual rollback: semantic types → LaTeX types
-- Run only if you need to revert migration 006
-- DELETE FROM _migrations WHERE name = '006_semantic_types.js';

UPDATE sections SET type = 'cventries' WHERE type IN ('experience', 'education', 'projects', 'presentations', 'leadership', 'volunteer', 'committees', 'extracurricular', 'writing');
UPDATE sections SET type = 'cvskills' WHERE type = 'skills';
UPDATE sections SET type = 'cvhonors' WHERE type IN ('honors', 'certifications');
UPDATE sections SET type = 'cvparagraph' WHERE type = 'summary';
UPDATE sections SET type = 'cvreferences' WHERE type = 'references';

-- NOTE: persons.data JSON blobs must be manually reverted if needed.
-- This script only handles the sections table.
