
import './index.css';

console.log('Renderer script loaded.');


const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const messageDiv = document.getElementById('message');


const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const appview = document.getElementById('app-view');
const repoview = document.getElementById('repo-view');

const logoutButton = document.getElementById('logout-button');
const createRepoButton = document.getElementById('create-repo-button');
const repoMessage = document.getElementById('repo-message'); 
const commitButton = document.getElementById('commit-button');
const commitMessageInput = document.getElementById('commit-message');
const commitOutput = document.getElementById('commit-output');
const logButton = document.getElementById('log-button');
const logOutput = document.getElementById('log-output');
const checkoutCommitIdInput = document.getElementById('checkout-commit-id');
const checkoutButton = document.getElementById('checkout-button');
const checkoutMessage = document.getElementById('checkout-message');



let currentRepoPath = null; 


function showView(viewId) {
    console.log("Attempting to show view:", viewId);
    
    document.querySelectorAll('.view').forEach(view => {
        if (view) view.style.display = 'none';
    });
    
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.style.display = 'block';
        console.log("Showing view:", viewId);
    } else {
        console.error("View not found:", viewId);
        
        const login = document.getElementById('login-view');
        if (login) login.style.display = 'block';
    }
}

function router() {
    const hash = window.location.hash;
    console.log("Routing based on hash:", hash);
    if (hash === '#/dashboard') {
        showView('dashboard-view');
    } else { 
        showView('login-view');
        
        currentRepoPath = null;
        console.log("Navigated to login, cleared currentRepoPath");
    }
}




if (window.electronAPI) {
    console.log('electronAPI is available on window.');
} else {
    console.error('electronAPI is *not* available. Check preload script and contextIsolation settings.');
    
    const errorDiv = document.createElement('div');
    errorDiv.textContent = 'CRITICAL ERROR: Backend communication failed. App cannot function.';
    errorDiv.style.color = 'red';
    errorDiv.style.fontWeight = 'bold';
    document.body.prepend(errorDiv); 
}


window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router); 


loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = usernameInput.value;
    const password = passwordInput.value;

    messageDiv.textContent = 'Logging in...';
    messageDiv.className = '';

    try {
        const result = await window.electronAPI.login(username, password);
        console.log('Login result:', result);

        if (result.success) {
            messageDiv.textContent = ''; 
            
            window.location.hash = '#/dashboard';
        } else {
            messageDiv.textContent = result.message || 'Login failed.';
            messageDiv.classList.add('error');
        }
    } catch (error) {
        console.error('Error calling login API:', error);
        messageDiv.textContent = 'An error occurred during login.';
        messageDiv.classList.add('error');
    }
});


logoutButton?.addEventListener('click', () => {
    console.log("Logout button clicked");
    
    usernameInput.value = '';
    passwordInput.value = '';
    messageDiv.textContent = '';
    messageDiv.className = '';
    commitMessageInput.value = '';
    commitOutput.textContent = '';
    repoMessage.textContent = ''; 
    repoMessage.className = '';

    appview.style.display = 'none';
    window.location.hash = '#/login'; 
});


createRepoButton?.addEventListener('click', async () => {
    console.log("Create repo button clicked");
    repoMessage.textContent = 'Selecting folder...'; 
    repoMessage.className = '';

    try {
        const result = await window.electronAPI.createRepository();
        console.log("Create repo result:", result);
        if (result.success) {
            currentRepoPath = result.path; 
            
            alert(`Repository created/initialized successfully at: ${currentRepoPath}`);
            repoMessage.textContent = `Repository ready at: ${currentRepoPath}`; 
            repoMessage.classList.add('success');
            appview.style.display = 'block';
            repoview.style.display = 'none';
        } else {
            
             alert(`Failed to create repository: ${result.message || 'Unknown error.'}`);
            repoMessage.textContent = result.message || 'Failed to create repository.';
            repoMessage.classList.add('error');
            currentRepoPath = null; 
        }
    } catch (err) {
        console.error('Error calling createRepository API:', err);
        alert(`Error creating repository: ${err.message}`);
        repoMessage.textContent = 'Error: ' + err.message;
        repoMessage.classList.add('error');
        currentRepoPath = null; 
    }
});


commitButton?.addEventListener('click', async () => {
    console.log("Commit button clicked");
    const message = commitMessageInput.value.trim();

    if (!currentRepoPath) {
        alert("Please create or select a repository folder first.");
        return;
    }
    if (!message) {
        alert("Please enter a commit message.");
        return;
    }

    commitOutput.textContent = 'Committing...'; 

    try {
        console.log(`Calling makeCommit API for repo: ${currentRepoPath}`);
        const result = await window.electronAPI.makeCommit(currentRepoPath, message);
        console.log("Commit result:", result);
        if (result.success) {
            commitOutput.textContent = `Commit successful: ${result.message || 'OK.'}\n`;
            commitMessageInput.value = ''; 
        } else {
            commitOutput.textContent = `Commit failed: ${result.message || 'Unknown error.'}`;
        }
    } catch (err) {
        console.error('Error calling makeCommit API:', err);
        commitOutput.textContent = `Commit failed: ${err.message}`;
    }
});

logButton?.addEventListener('click', async () => {
    console.log("Log button clicked");
    if (!currentRepoPath) {
        alert("Please create or select a repository folder first.");
        logOutput.textContent = 'No repository selected.'; 
        return;
    }

    logOutput.textContent = 'Fetching log...'; 

    try {
        console.log(`Calling getLog API for repo: ${currentRepoPath}`);
        
        const result = await window.electronAPI.getLog(currentRepoPath);
        console.log("Log result:", result); 

        if (result && result.success) {
            if (result.logs && result.logs.length > 0) {
                
                let formattedLog = "Commit History:\n";
                formattedLog += "-----------------\n";
                result.logs.forEach(commit => {
                    formattedLog += `Commit: ${commit.id}\n`;
                    formattedLog += `Date:   ${new Date(commit.timestamp).toLocaleString()}\n`; 
                    formattedLog += `Message: ${commit.message}\n`;
                    formattedLog += "-----------------\n";
                });
                logOutput.textContent = formattedLog;
            } else {
                logOutput.textContent = 'No commits found in this repository yet.';
            }
        } else {
            
            logOutput.textContent = `Failed to fetch log: ${result ? result.message : 'Unknown error.'}`;
        }
    } catch (err) {
        console.error('Error calling getLog API:', err);
        logOutput.textContent = `Error fetching log: ${err.message}`;
    }
});
checkoutButton?.addEventListener('click', async () => {
    console.log("Checkout button clicked");
    const commitIdToCheckout = checkoutCommitIdInput.value.trim(); 

    
    if (!currentRepoPath) {
        alert("Please create or select a repository folder first.");
        checkoutMessage.textContent = 'No repository selected.';
        checkoutMessage.style.color = 'red';
        return;
    }
    if (!commitIdToCheckout) {
        alert("Please enter a Commit ID from the log to checkout.");
        checkoutMessage.textContent = 'Commit ID cannot be empty.';
        checkoutMessage.style.color = 'red';
        return;
    }
    
    if (isNaN(parseInt(commitIdToCheckout))) {
         alert("Please enter a valid Commit ID (should be a number).");
         checkoutMessage.textContent = 'Invalid Commit ID format.';
         checkoutMessage.style.color = 'red';
         return;
    }

    
    const confirmation = confirm(`WARNING!\n\nChecking out commit '<span class="math-inline">\{commitIdToCheckout\}' will overwrite or delete files in your current working directory \(</span>{currentRepoPath}) to match the state of that commit.\n\nAre you sure you want to proceed?`);
    if (!confirmation) {
        checkoutMessage.textContent = 'Checkout cancelled by user.';
        checkoutMessage.style.color = 'orange';
        return;
    }

    
    checkoutMessage.textContent = `Checking out commit ${commitIdToCheckout}...`; 
    checkoutMessage.style.color = 'black'; 

    try {
        console.log(`Calling checkoutCommit API for repo: ${currentRepoPath}, commitId: ${commitIdToCheckout}`);
        
        const result = await window.electronAPI.checkoutCommit(currentRepoPath, parseInt(commitIdToCheckout)); 
        console.log("Checkout result:", result); 

        if (result && result.success) {
            checkoutMessage.textContent = result.message || `Successfully checked out commit ${commitIdToCheckout}.`;
            checkoutMessage.style.color = 'green';
            
            
            
        } else {
            checkoutMessage.textContent = `Checkout failed: ${result ? result.message : 'Unknown error.'}`;
            checkoutMessage.style.color = 'red';
        }
    } catch (err) {
        console.error('Error calling checkoutCommit API:', err);
        checkoutMessage.textContent = `Checkout failed: ${err.message}`;
        checkoutMessage.style.color = 'red';
    }
});
