const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const canvas = require('canvas');
const { createCanvas } = require('canvas');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const dotenv = require('dotenv')
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto = require('crypto');


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Configuration and Setup
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const app = express();
const PORT = 3000;

// Load environment variables from .env file
dotenv.config();

// Use environment variables for client ID and secret
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Configure passport
passport.use(new GoogleStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: `http://localhost:${PORT}/auth/google/callback`
}, (token, tokenSecret, profile, done) => {
    return done(null, profile);
}));


passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

/*
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    Handlebars Helpers

    Handlebars helpers are custom functions that can be used within the templates 
    to perform specific tasks. They enhance the functionality of templates and 
    help simplify data manipulation directly within the view files.

    In this project, two helpers are provided:
    
    1. toLowerCase:
       - Converts a given string to lowercase.
       - Usage example: {{toLowerCase 'SAMPLE STRING'}} -> 'sample string'

    2. ifCond:
       - Compares two values for equality and returns a block of content based on 
         the comparison result.
       - Usage example: 
            {{#ifCond value1 value2}}
                <!-- Content if value1 equals value2 -->
            {{else}}
                <!-- Content if value1 does not equal value2 -->
            {{/ifCond}}
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
*/

// Set up Handlebars view engine with custom helpers
//
app.engine(
    'handlebars',
    expressHandlebars.engine({
        helpers: {
            toLowerCase: function (str) {
                return str.toLowerCase();
            },
            ifCond: function (v1, v2, options) {
                if (v1 === v2) {
                    return options.fn(this);
                }
                return options.inverse(this);
            },
        },
    })
);

app.set('view engine', 'handlebars');
app.set('views', './views');


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Middleware
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.use(
    session({
        secret: 'oneringtorulethemall',     // Secret key to sign the session ID cookie
        resave: false,                      // Don't save session if unmodified
        saveUninitialized: false,           // Don't create session until something stored
        cookie: { secure: false },          // True if using https. Set to false for development without https
    })
);

//Passport set up
app.use(passport.initialize());
app.use(passport.session());

// Middleware to set local variables for templates
app.use((req, res, next) => {
    res.locals.appName = 'Hiking Trail Blog';
    res.locals.copyrightYear = 2024;
    res.locals.postNeoType = 'Post';
    res.locals.loggedIn = req.session.loggedIn || false;
    res.locals.userId = req.session.userId || '';
    next();
});

// Other middleware setup
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Routes
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Home route: render home view with posts and user
// We pass the posts and user variables into the home
// template
//
app.get('/', async (req, res) => {
    const posts = await getPosts();
    const user = await getCurrentUser(req) || {};
    res.render('home', { posts, user});
});

// Register GET route is used for error response from registration
//
app.get('/registerUsername', (req, res) => {
    res.render('registerUsername', { regError: req.query.error });
});

// Login route GET route is used for error response from login
//
app.get('/login', (req, res) => {
    res.render('login', { loginError: req.query.error })
});

// Error route: render error page
//
app.get('/error', (req, res) => {
    res.render('error');
});

//Adds a new post to the db
//
app.post('/posts', async (req, res) => {
    await addPost(req.body.title, req.body.content, await getCurrentUser(req));
    res.redirect('/');
});

//Update a posts likes
//
app.post('/like/:id', async (req, res) => {
    if(req.session.username !== undefined){
        await updatePostLikes(req,res);
    }
    res.redirect('/');
});

//Returns profile template
//
app.get('/profile', isAuthenticated, async (req, res) => {
    // TODO: Render profile page
    const user = await getCurrentUser(req);
    const posts = await renderProfile(req, res)
    res.render('profile', {posts, user, regError: req.query.error})
});

//Reuturns a user avatar based on a username
//
app.get('/avatar/:username', async (req, res) => {
    const avatar = await handleAvatar(req,res);
    res.setHeader('Content-Type', 'image/png');
    res.send(avatar);
});

//Directs the users to google OAuth sign in
//
app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }))

//logs in the user if the hashedGoogle id exists, otherwise redirect to register
//
app.get('/auth/google/callback', 
    passport.authenticate('google', {failureRedirect: '/'}), 
    async (req, res) => {
        const googleId = req.user.id;
        const hashedGoogleId = hashId(googleId)
        req.session.hashedGoogleId = hashedGoogleId;

        try {
            let localUser = await findUserByHashedGoogleId(hashedGoogleId);
            if (localUser) {
                req.session.userId = localUser.id;
                req.session.loggedIn = true;
                req.session.username = localUser.username;
                req.session.avatar_url = localUser.avatar_url;
                req.session.memberSince = localUser.memberSince;
                res.redirect('/');
            } else {
                res.redirect('/registerUsername');
            }
        }
        catch(err){
            console.error('Error finding user:', err);
            res.redirect('/error');
        }
});


//Clears session variables and redirects to homepage
//
app.get('/logout', (req, res) => {
    logoutUser(req,res);
    res.redirect('/googleLogout');
});

//Logs out user from google
//
app.get('/googleLogout', (req, res) => {
    res.render('googleLogout');
});

//redirects to home after succeful logout
//
app.get('/logoutCallback', (req, res) => {
    res.redirect('/');
});


//Register post route to add user name to registered user name list
//
app.post('/registerUsername', async (req, res) => {
    if(!await findUserByUsername(req.body.userName)){
        await registerUser(req, res);
        await loginUser(req, res);
        res.redirect('/'); //Return to login/reg page, user has been added
    }
    else{
        res.redirect('/registerUsername?error=Already%20Registered'); //Return to log/reg page with error
    }
});

//Updates current users username
//
app.post('/updateUsername', async (req,res) => {
    const user = await findUserByUsername(req.body.userName);
    if(user){
        res.redirect('/Profile?error=Already%20Registered');
    }
    else{
        await updateUserInDB(req, res);
        req.session.username = req.body.userName;
        res.redirect('/Profile');
    }
});

//Deletes a post based on a post id
//
app.post('/delete/:id', isAuthenticated, async (req, res) => {
    await deletePost(req,res);
    res.redirect('/');
});

//Deletes a users account from the db and all posts
//then logs them out of their session
//
app.post('/deleteAccount', isAuthenticated, async (req, res) => {
    await deleteUserPosts(req, res);
    await deleteUser(req, res);
    await logoutUser(req, res);
    res.redirect('/googleLogout');
});

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Server Activation
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
//Hashing Function
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const hashId = (id) => {
    return crypto.createHash('sha256').update(id.toString()).digest('hex');
};


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
//Initlize DB
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const dbFileName = 'websiteData.db';

async function initializeDB() {
    const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });

    // Check if users and posts tables exist
    const usersTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='users';`);
    const postsTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts';`);

    if (usersTableExists && postsTableExists) {
        console.log('Database tables already exist. Skipping initialization.');
        await db.close();
        return;
    }

    // If tables don't exist, initialize them and populate with sample data
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            hashedGoogleId TEXT NOT NULL UNIQUE,
            avatar_url TEXT,
            memberSince DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            username TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            likes INTEGER NOT NULL
        );
    `);

    const test1 = generateAvatar('S');
    const test2 = generateAvatar('A');
    // Sample data - Replace these arrays with your own data
    const users = [
        { username: 'SampleUser', hashedGoogleId: 'hashedGoogleId1', avatar_url: test1, memberSince: '2024-01-01 12:00:00' },
        { username: 'AnotherUser', hashedGoogleId: 'hashedGoogleId2', avatar_url: test2, memberSince: '2024-01-02 12:00:00' }
    ];

    const posts = [
        { title: 'First Post', content: 'This is the first post', username: 'SampleUser', timestamp: '2024-01-01 12:30:00', likes: 0 },
        { title: 'Second Post', content: 'This is the second post', username: 'AnotherUser', timestamp: '2024-01-02 12:30:00', likes: 0 }
    ];

    // Insert sample data into the database
    await Promise.all(users.map(user => {
        return db.run(
            'INSERT INTO users (username, hashedGoogleId, avatar_url, memberSince) VALUES (?, ?, ?, ?)',
            [user.username, user.hashedGoogleId, user.avatar_url, user.memberSince]
        );
    }));

    await Promise.all(posts.map(post => {
        return db.run(
            'INSERT INTO posts (title, content, username, timestamp, likes) VALUES (?, ?, ?, ?, ?)',
            [post.title, post.content, post.username, post.timestamp, post.likes]
        );
    }));

    console.log('Database initialized with sample data.');
    await db.close();
}

initializeDB().catch(err => {
    console.error('Error initializing database:', err);
});

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Support Functions
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

//Update a users username in the db
async function updateUserInDB(req, res){
    try {
        // Open a connection to the database
        const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });


        // Update the username in the database
        await db.run('UPDATE users SET username = ? WHERE username = ?', [req.body.userName, req.session.username]);
        await db.run('UPDATE posts SET username = ? WHERE username = ?', [req.body.userName, req.session.username]);
        //New avatar generation
        const avatar = generateAvatar(getFirstLetter(req.body.userName));
        await db.run('UPDATE users SET avatar_url = ? WHERE username = ?', [avatar, req.body.userName]);

        // Close the database connection
        await db.close();

        // Respond with a success message
        console.log('User updated successfully');
    } catch (error) {
        console.error('Error updating username:', error);
    }
}

//delete a user from the db
async function deleteUser (req, res){
    try{
        const db = await sqlite.open({filename: dbFileName, driver: sqlite3.Database});

        const user = await db.get('SELECT * FROM users WHERE username = ?', [req.session.username]);

        if (!user){
            console.log('User not found');
            await db.close();
            return;
        }

        await db.run('DELETE FROM users WHERE username = ?', [req.session.username]);
        await db.close();
        console.log('user deleted succefully');
    }
    catch (error) {
        console.error('Error deleting user:', error);
    }
}

//function to delete all of the posts from a user in the db
async function deleteUserPosts (req, res){
    try{
        const db = await sqlite.open({filename: dbFileName, driver: sqlite3.Database});

        const user = await db.get('SELECT * FROM users WHERE username = ?', [req.session.username]);

        if (!user){
            console.log('User not found');
            await db.close();
            return;
        }

        await db.run('DELETE FROM posts WHERE username = ?', [req.session.username]);
        await db.close();
        console.log('user posts deleted succefully');
    }
    catch (error) {
        console.error('Error deleting user posts:', error);
    }
}


// Function to find a user by username

async function findUserByUsername(username) {
    try {
        const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });


        // Check if the users table exists
        const usersTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='users';`);
        if (!usersTableExists) {
            console.log('Users table does not exist.');
            await db.close();
            return false;
        }

        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        await db.close();

        if (user) {
            return user;
        } else {
            console.log('User not found.');
            return false;
        }
    } catch (error) {
        console.error('Error finding user:', error);
        return false;
    }
}

// Function to find a user by google ID
async function findUserByHashedGoogleId(hashedId) {
    try {
        const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });

        // Check if the users table exists
        const usersTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='users';`);
        if (!usersTableExists) {
            console.log('Users table does not exist.');
            await db.close();
            return false;
        }

        const user = await db.get('SELECT * FROM users WHERE hashedGoogleId = ?', [hashedId]);
        await db.close();

        if (user) {
            return user;
        } else {
            console.log('id not found.');
            return false;
        }
    } catch (error) {
        console.error('Error finding id:', error);
        return false;
    }
}

//get the current date and format it
function getDate(){
    const date = new Date();

    const day = date.getDay();
    const month = date.getMonth();
    const year = date.getFullYear();

    const hour = date.getHours();
    const minutes = date.getMinutes();

    return year+'-'+month+'-'+day+'  '+hour+':'+minutes;
}

// Function to add a new user
async function addUser(username, req) {    
    try {
        const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });

        await db.run(
            'INSERT INTO users (username, hashedGoogleId, avatar_url, memberSince) VALUES (?, ?, ?, ?)',
            [username, req.session.hashedGoogleId, generateAvatar(getFirstLetter(username)), getDate()]
        );
        await db.close();
        console.log('Post added successfully');
    } catch (error) {
        console.error('Error adding user:', error);

    }
}

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    console.log(req.session.userId);
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Function to register a user
async function registerUser(req, res) {
    await addUser(req.body.userName, req);
}

//Function to login a user
async function loginUser(req, res) {
    try {
        const user = await findUserByUsername(req.body.userName);
        if (user) {
            console.log("LOGGING IN: ", user.username);
            req.session.userId = user.id;
            req.session.loggedIn = true;
            req.session.username = user.username;
            req.session.avatar_url = user.avatar_url;
            req.session.memberSince = user.memberSince;
        } else {
            console.log("User not found during login.");
        }
    } catch (error) {
        console.error("Error during login:", error);
        // Handle error case
    }
}

// Function to logout a user
function logoutUser(req, res) {
    req.session.userId = undefined;
    req.session.loggedIn = false;
    req.session.username = undefined;
    req.session.avatar_url =  undefined;
    req.session.memberSince = undefined;
    req.session.hashedGoogleId = undefined;
}

// Function to render the profile page
async function renderProfile(req, res) {
    const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });

    let filteredPosts = [];

    const postsTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts';`);
    if (postsTableExists) {
        const posts = await db.all('SELECT * FROM posts WHERE username=?', [req.session.username]);
        if (posts.length > 0) {
            posts.forEach(post => {
                filteredPosts.push(post);
            });
        } else {
            console.log('No posts found.');
        }
    } else {
        console.log('Posts table does not exist.');
    }

    await db.close();
    return filteredPosts.slice().reverse();;
}

// Function to update post likes
async function updatePostLikes(req, res) {
    try {
        const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });
        // Retrieve the post by its id
        const post = await db.get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
        await db.run(
            'UPDATE posts SET likes = ? WHERE id = ?',
            [post.likes + 1, req.params.id]
        );
        await db.close();
    } catch (error) {
        console.error('Error updating likes: ', error);
    }
}

//Function to find the first letter of a username
function getFirstLetter(username){
    const letters = username.match(/[a-zA-z]/) //Array of letters matching regExp

    if(letters){
        return letters[0];
    }
    else{
        return 'A'; //Default if username contains no letters
    }
}

// Function to handle avatar generation and serving
async function handleAvatar(req, res) {
    let user = await findUserByUsername(req.params.username);
    if (user) {
        if (user.avatar_url === undefined) {
            user.avatar_url = generateAvatar(getFirstLetter(req.session.username));
            return user.avatar_url;
        } else {
            return user.avatar_url;
        }
    } else {
        // Handle case where user is not found
        console.log("User not found");
        return null;
    }
}

// Function to get the current user from session
async function getCurrentUser(req) {
    return await findUserByUsername(req.session.username);
}

// Function to get all posts
async function getPosts() {
    const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });

    let userPosts  = [];

    const postsTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts';`);
    if (postsTableExists) {
        const posts = await db.all('SELECT * FROM posts');
        if (posts.length > 0) {
            posts.forEach(post => {
                userPosts.push(post);
            });
        } else {
            console.log('No posts found.');
        }
    } else {
        console.log('Posts table does not exist.');
    }

    await db.close();
    return userPosts;
}

// Function to add a new post
async function addPost(title, content, user) {
    try {
        const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });
        await db.run(
            'INSERT INTO posts (title, content, username, timestamp, likes) VALUES (?, ?, ?, ?, ?)',
            [title, content, user.username, getDate(), 0]
        );
        await db.close();
        console.log('Post added successfully');
    } catch (error) {
        console.error('Error adding post:', error);
    }
}

//Function to delete a post
async function deletePost(req,res){
    try {
        const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });
        
        // Retrieve the post by its id
        const post = await db.get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
        
        if (!post) {
            console.log('Post not found');
            await db.close();
            return;
        }
        
        // Check if the username matches
        if (post.username !== req.session.username) {
            console.log('Username does not match');
            await db.close();
            return;
        }
        
        // Delete the post if the username matches
        await db.run('DELETE FROM posts WHERE id = ?', [req.params.id]);
        await db.close();
        console.log('Post deleted successfully');
    } catch (error) {
        console.error('Error deleting post:', error);
    }

}

// Function to generate an image avatar
function generateAvatar(letter, width = 100, height = 100) {
    const colorScheme = ["#4369D9", "#C2E0F2", "#95A617", "#D9C355", "#BFAB6F"];

    if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
        throw new Error('Invalid width or height values');
    }

    //generate canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    //background
    ctx.fillStyle = colorScheme[Math.floor(Math.random() * 5)];
    roundedRect(ctx, 0, 0, width, height, 10);
    ctx.fill();

    //text
    ctx.fillStyle = '#000000';
    ctx.font = `${Math.min(width, height) * 0.6}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter.toUpperCase(), width / 2, height / 2);

    //Return the avatar as a PNG buffer
    return canvas.toBuffer('image/png');
}

//Source: https://www.youtube.com/watch?v=nVal6k08pQY
// Function to draw a rounded rectangle
function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}