const bcrypt = require('bcrypt');
bcrypt.hash('Password123!', 10).then(hash => console.log(hash));
