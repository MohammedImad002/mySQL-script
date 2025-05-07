//Add "Questions" topic to each chapter and insert the question videos as a material entry

const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// MySQL config
const dbConfig = {
  host: 'eduinstitureprod1.ca1u7lspatde.ap-south-1.rds.amazonaws.com',
  user: 'eduDB',
  password: 'Upmyranks2022',
  database: 'eduInstitute'
};

// Configuration
const GRADE_FOLDER = 'grade-9';
const SUBJECT_FOLDER = 'biology';

// Function to read materials from JSON files
async function getMaterialsFromJsonFolder() {
  const materialsMap = new Map();
  const jsonFolder = path.join(__dirname, 'json');
  
  if (!fs.existsSync(jsonFolder)) {
    throw new Error(`JSON folder not found at: ${jsonFolder}`);
  }

  const gradePath = path.join(jsonFolder, GRADE_FOLDER);
  if (!fs.existsSync(gradePath)) {
    throw new Error(`Grade folder not found: ${GRADE_FOLDER}`);
  }

  const subjectPath = path.join(gradePath, SUBJECT_FOLDER);
  if (!fs.existsSync(subjectPath)) {
    throw new Error(`Subject folder not found: ${SUBJECT_FOLDER}`);
  }
  
  // Read all JSON files in the subject folder
  const jsonFiles = fs.readdirSync(subjectPath).filter(file => file.endsWith('.json'));
  
  if (jsonFiles.length === 0) {
    throw new Error(`No JSON files found in ${GRADE_FOLDER}/${SUBJECT_FOLDER}`);
  }

  console.log(`\n📚 Reading materials from ${GRADE_FOLDER}/${SUBJECT_FOLDER}:`);
  
  for (const jsonFile of jsonFiles) {
    const filePath = path.join(subjectPath, jsonFile);
    try {
      const materials = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(materials)) {
        console.warn(`⚠️ Warning: ${jsonFile} does not contain an array of materials`);
        continue;
      }
      
      // Use the filename (without extension) as the chapter identifier
      const chapterKey = path.parse(jsonFile).name;
      materialsMap.set(chapterKey, materials);
      console.log(`📄 Found ${materials.length} materials in ${jsonFile}`);
    } catch (err) {
      console.error(`❌ Error reading ${jsonFile}: ${err.message}`);
    }
  }
  
  if (materialsMap.size === 0) {
    throw new Error('No valid materials found in any JSON files');
  }
  
  return materialsMap;
}

// Function to normalize strings for comparison
function normalizeString(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric characters
    .trim();
}

(async () => {
  let conn;
  try {
    console.log('🔌 Connecting to database...');
    conn = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to database successfully');

    console.log('📥 Fetching chapters...');
    const [chapters] = await conn.execute(`
      SELECT id, course_name FROM course 
      WHERE parent_id = "b0e200d7-5205-4d8a-a86d-7ddafb78e7bb" AND status = 'ACTIVE'
    `);

    if (chapters.length === 0) {
      throw new Error('No active chapters found for the specified parent_id');
    }

    console.log(`📘 Found ${chapters.length} chapters in database.`);
    
    // Get all materials from JSON folder
    console.log('📚 Reading materials from JSON files...');
    const materialsMap = await getMaterialsFromJsonFolder();
    console.log(`📚 Found ${materialsMap.size} JSON files with materials.`);

    // Create a map of normalized chapter names to their materials
    const normalizedMaterialsMap = new Map();
    for (const [chapterKey, materials] of materialsMap.entries()) {
      normalizedMaterialsMap.set(normalizeString(chapterKey), materials);
    }

    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const chapter of chapters) {
      try {
        const normalizedChapterName = normalizeString(chapter.course_name);
        const materials = normalizedMaterialsMap.get(normalizedChapterName);
        
        if (!materials) {
          console.log(`⏭️  Skipping chapter: "${chapter.course_name}" - No matching materials found`);
          skippedCount++;
          continue;
        }

        const topicId = uuidv4();
        const topicName = "Questions";

        // Insert the "Questions" topic
        await conn.execute(`
          INSERT INTO course (
            id, coaching_centre_id, course_name, created_at, created_by,
            description, parent_id, parent_name, status, updated_at,
            updated_by, type, session_id, session_name, amount
          ) VALUES (?, NULL, ?, NOW(), NULL,
            ?, ?, NULL, 'ACTIVE', NOW(),
            NULL, 'nonPrivate', NULL, NULL, NULL
          )
        `, [
          topicId,
          topicName,
          "Questions for this chapter",
          chapter.id
        ]);

        console.log(`✅ Created topic "Questions" under chapter: "${chapter.course_name}" (${chapter.id})`);

        // Insert each video as a material entry
        for (let i = 0; i < materials.length; i++) {
          const material = materials[i];
          const materialId = uuidv4();

          await conn.execute(`
            INSERT INTO material (
              id, chat_url, coaching_center_branch_id, coaching_center_branch_name,
              coaching_center_id, coaching_center_name, course_id, course_name,
              created_at, created_by, description, file_path, material_type,
              order_sequence, status, title, updated_at, updated_by
            ) VALUES (?, 'undefined', NULL, NULL, NULL, NULL, ?, ?, NOW(), NULL,
              ?, ?, 'video', ?, 'ACTIVE', ?, NOW(), NULL
            )
          `, [
            materialId,
            topicId,
            topicName,
            material.url, // description = video URL
            material.url, // file_path = same as video URL
            (i + 1).toString(), // order_sequence
            material.name // title
          ]);

          console.log(`🎞️  Added material: ${material.name}`);
        }
        processedCount++;
      } catch (err) {
        console.error(`❌ Error processing chapter "${chapter.course_name}": ${err.message}`);
        errorCount++;
      }
    }

    console.log('\n📊 Processing Summary:');
    console.log(`✅ Successfully processed: ${processedCount} chapters`);
    console.log(`⏭️  Skipped: ${skippedCount} chapters`);
    console.log(`❌ Errors: ${errorCount} chapters`);
    console.log(`📘 Total chapters: ${chapters.length}`);

  } catch (err) {
    console.error('❌ Fatal Error:', err.message);
    process.exit(1);
  } finally {
    if (conn) {
      await conn.end();
      console.log('🔌 Database connection closed');
    }
  }
})();
