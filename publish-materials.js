const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

// MySQL config
const dbConfig = {
  host: '',
  user: '',
  password: '',
  database: ''
};

// Configuration
const BATCH_ID = 'd665589f-1358-44fe-ac24-fd99167a27f2';
const COURSE_ID = 'c0d0ed66-a6be-493d-88be-d0cba6688961';
const TARGET_DATE = '2025-05-07';

// Function to get current date and time in required format
function getCurrentDateTime() {
  const now = new Date();
  return {
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().split(' ')[0].substring(0, 5)
  };
}

// Function to get course hierarchy
async function getCourseHierarchy(conn, courseId) {
  // Get course name
  const [courseInfo] = await conn.execute(`
    SELECT course_name 
    FROM course 
    WHERE id = ?
  `, [courseId]);

  if (courseInfo.length === 0) {
    throw new Error(`Course not found with ID: ${courseId}`);
  }

  const courseName = courseInfo[0].course_name;

  // Get subjects under the course
  const [subjects] = await conn.execute(`
    SELECT id as subject_id, course_name
    FROM course 
    WHERE parent_id = ? AND status = 'ACTIVE'
  `, [courseId]);

  if (subjects.length === 0) {
    throw new Error(`No active subjects found for course: ${courseName} (${courseId})`);
  }

  console.log(`\n📚 Course Hierarchy:`);
  console.log(`Course: ${courseName} (${courseId})`);

  // Get chapters under each subject
  for (const subject of subjects) {
    console.log(`\nSubject: ${subject.course_name} (${subject.subject_id})`);
    const [chapters] = await conn.execute(`
      SELECT id as chapter_id, course_name
      FROM course 
      WHERE parent_id = ? AND status = 'ACTIVE'
    `, [subject.subject_id]);
    subject.chapters = chapters;

    // Get topics under each chapter
    for (const chapter of chapters) {
      console.log(`  Chapter: ${chapter.course_name} (${chapter.chapter_id})`);
      const [topics] = await conn.execute(`
        SELECT id as topic_id, course_name
        FROM course 
        WHERE parent_id = ? AND status = 'ACTIVE'
      `, [chapter.chapter_id]);
      chapter.topics = topics;

      for (const topic of topics) {
        console.log(`    Topic: ${topic.course_name} (${topic.topic_id})`);
      }
    }
  }

  return subjects;
}

(async () => {
  let conn;
  try {
    console.log('🔌 Connecting to database...');
    conn = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to database successfully');

    // Get course hierarchy
    console.log(`📥 Fetching course hierarchy...`);
    const subjects = await getCourseHierarchy(conn, COURSE_ID);
    console.log(`\n📚 Found ${subjects.length} subjects`);

    // Get all materials that need to be published
    console.log(`\n📥 Fetching materials created on ${TARGET_DATE}...`);
    const [materials] = await conn.execute(`
      SELECT 
        m.id as material_id,
        m.title as material_title,
        m.course_id as topic_id,
        c.course_name as topic_name,
        c.parent_id as chapter_id,
        c2.course_name as chapter_name,
        c2.parent_id as subject_id,
        c3.course_name as subject_name,
        c2.id as chapter_id,
        c3.id as subject_id
      FROM material m
      JOIN course c ON m.course_id = c.id
      JOIN course c2 ON c.parent_id = c2.id
      JOIN course c3 ON c2.parent_id = c3.id
      WHERE m.status = 'ACTIVE'
      AND DATE(m.created_at) = ?
      AND c3.parent_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM material_access ma 
        WHERE ma.material_id = m.id
      )
    `, [TARGET_DATE, COURSE_ID]);

    if (materials.length === 0) {
      console.log('ℹ️ No new materials to publish');
      process.exit(0);
    }

    console.log(`📚 Found ${materials.length} materials to publish`);

    const { date, time } = getCurrentDateTime();
    let successCount = 0;
    let errorCount = 0;

    // Insert material access records
    for (const material of materials) {
      try {
        const materialAccessId = uuidv4();
        
        await conn.execute(`
          INSERT INTO material_access (
            id, batch_id, chapter_id, course_id, created_at,
            created_by, material_id, publish_date, publish_time,
            status, subject_id, topic_id, updated_at, updated_by
          ) VALUES (?, ?, ?, ?, NOW(),
            NULL, ?, ?, ?,
            'ACTIVE', ?, ?, NOW(), NULL
          )
        `, [
          materialAccessId,
          BATCH_ID,
          material.chapter_id,
          COURSE_ID,
          material.material_id,
          date,
          time,
          material.subject_id,
          material.topic_id
        ]);

        console.log(`✅ Published material: "${material.material_title}" (${material.material_id})`);
        console.log(`   Subject: ${material.subject_name} (${material.subject_id})`);
        console.log(`   Chapter: ${material.chapter_name} (${material.chapter_id})`);
        console.log(`   Topic: ${material.topic_name} (${material.topic_id})`);
        successCount++;
      } catch (err) {
        console.error(`❌ Error publishing material "${material.material_title}" (${material.material_id}): ${err.message}`);
        errorCount++;
      }
    }

    console.log('\n📊 Publishing Summary:');
    console.log(`✅ Successfully published: ${successCount} materials`);
    console.log(`❌ Errors: ${errorCount} materials`);
    console.log(`📚 Total materials: ${materials.length}`);

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